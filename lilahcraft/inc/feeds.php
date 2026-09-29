<?php
/**
 * Same-origin REST routes for the live data.
 *
 *   GET /wp-json/lilahcraft/v1/market   the Market feed (HomeCraftMgmt /api/market), without the long
 *                                       history; ?long=1 adds history7d and history30d when the feed has them,
 *                                       and the live market's chart markers (events)
 *   GET /wp-json/lilahcraft/v1/minis    the Minis feed  (HomeCraftMgmt /api/minis)
 *   GET /wp-json/lilahcraft/v1/status   { online, players, max, version }
 *
 * WordPress fetches each feed, keeps it in a transient for the configured seconds and keeps the
 * last good copy in an option (both whole, long history included). A failed fetch serves that copy
 * with "stale": true. With no URL set, or nothing good yet, the answer is { "sample": true } and the
 * page shows labelled sample data. Only whitelisted fields are passed on. The live market's fields
 * (HomeCraftMgmt 0.33) only come through while the feed says "live": true; without them the answer
 * is exactly what 2.1 served.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

add_action(
	'rest_api_init',
	function () {
		foreach ( array( 'market', 'minis', 'status' ) as $route ) {
			register_rest_route(
				'lilahcraft/v1',
				'/' . $route,
				array(
					'methods'             => 'GET',
					'permission_callback' => '__return_true',
					'callback'            => function ( WP_REST_Request $request ) use ( $route ) {
						$data = 'status' === $route ? lilahcraft_server_status() : lilahcraft_get_feed( $route );
						// Only the Market page asks for 7D/30D (?long=1): Home's refreshes stay small.
						if ( 'market' === $route && '1' !== (string) $request->get_param( 'long' ) ) {
							$data = lilahcraft_market_lean( $data );
						}
						return lilahcraft_rest_response( $data, $request );
					},
				)
			);
		}
	}
);

/**
 * The Market feed without the long history (history7d, history30d: up to 288 more points per item)
 * and the chart markers (events), which only the Market page's chart uses.
 *
 * @param array $data Market feed, as stored.
 * @return array
 */
function lilahcraft_market_lean( $data ) {
	if ( empty( $data['items'] ) || ! is_array( $data['items'] ) ) {
		return $data;
	}
	foreach ( array_keys( $data['items'] ) as $i ) {
		unset( $data['items'][ $i ]['history7d'], $data['items'][ $i ]['history30d'], $data['items'][ $i ]['events'] );
	}
	return $data;
}

/**
 * JSON response with an ETag, so an unchanged feed costs the browser a 304.
 *
 * @param array           $data    Body.
 * @param WP_REST_Request $request Request.
 * @return WP_REST_Response
 */
function lilahcraft_rest_response( $data, $request ) {
	$etag = '"' . md5( wp_json_encode( $data ) ) . '"';
	$res  = new WP_REST_Response( $data, 200 );
	// A proxy that gzips may have turned the tag into a weak one (W/"...").
	if ( preg_replace( '#^W/#', '', trim( (string) $request->get_header( 'if_none_match' ) ) ) === $etag ) {
		$res = new WP_REST_Response( null, 304 );
	}
	$res->header( 'ETag', $etag );
	$res->header( 'Cache-Control', 'no-cache' );
	return $res;
}

/**
 * A feed, from cache, the network or the last good copy.
 *
 * @param string $feed market or minis.
 * @return array
 */
function lilahcraft_get_feed( $feed ) {
	$url = (string) lilahcraft_setting( $feed . '_url' );
	if ( '' === $url ) {
		return array( 'sample' => true );
	}

	$cached = get_transient( 'lilahcraft_feed_' . $feed );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$ttl  = max( 5, (int) lilahcraft_setting( 'cache_seconds' ) );
	$last = get_option( 'lilahcraft_last_' . $feed );
	$last = ( is_array( $last ) && isset( $last['url'], $last['data'] ) && $last['url'] === $url ) ? $last['data'] : null;

	// Someone else is already fetching: hand out the last good copy rather than queue up behind a slow server.
	if ( $last && get_transient( 'lilahcraft_lock_' . $feed ) ) {
		$last['stale'] = ( time() * 1000 - (int) $last['fetchedAt'] ) > $ttl * 3000;
		return $last;
	}
	set_transient( 'lilahcraft_lock_' . $feed, 1, 15 );

	$fresh = lilahcraft_fetch_feed( $feed, $url );
	delete_transient( 'lilahcraft_lock_' . $feed );

	if ( ! is_wp_error( $fresh ) ) {
		$fresh['stale']     = false;
		$fresh['fetchedAt'] = (int) round( microtime( true ) * 1000 );
		update_option(
			'lilahcraft_last_' . $feed,
			array(
				'url'  => $url,
				'data' => $fresh,
			),
			false
		);
		lilahcraft_note_feed( $feed, true, '', $url );
		set_transient( 'lilahcraft_feed_' . $feed, $fresh, $ttl );
		return $fresh;
	}

	lilahcraft_note_feed( $feed, false, $fresh->get_error_message(), $url );
	if ( $last ) {
		$out          = $last;
		$out['stale'] = true;
	} else {
		$out = array(
			'sample'      => true,
			'unreachable' => true,
		);
	}
	// Try again sooner than a normal refresh, but not on every page view.
	set_transient( 'lilahcraft_feed_' . $feed, $out, min( $ttl, 30 ) );
	return $out;
}

/**
 * Remember how the last fetch went, for the settings page.
 *
 * @param string $feed  market or minis.
 * @param bool   $ok    Whether it worked.
 * @param string $error Error text.
 * @param string $url   The URL fetched: the settings page only shows the note for that URL.
 */
function lilahcraft_note_feed( $feed, $ok, $error, $url = '' ) {
	update_option(
		'lilahcraft_feedstat_' . $feed,
		array(
			'time'  => time(),
			'ok'    => (bool) $ok,
			'error' => substr( sanitize_text_field( $error ), 0, 200 ),
			'url'   => (string) $url,
		),
		false
	);
}

/**
 * Fetch and clean a feed.
 *
 * @param string $feed market or minis.
 * @param string $url  Feed URL.
 * @return array|WP_Error
 */
function lilahcraft_fetch_feed( $feed, $url ) {
	// WordPress sends the same headers on to wherever a redirect points (another host, plain http),
	// so with a feed token set, redirects are not followed.
	$token = '' !== (string) lilahcraft_setting( 'feed_token' );
	$res   = wp_remote_get(
		$url,
		array(
			'timeout'     => 5,
			'redirection' => $token ? 0 : 2,
			'headers'     => lilahcraft_feed_headers(),
			'user-agent'  => 'LilahCraft site/' . wp_get_theme( get_template() )->get( 'Version' ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
	if ( $token && $code >= 300 && $code < 400 ) {
		/* translators: %d: HTTP status code. */
		return new WP_Error( 'lilahcraft_feed', sprintf( __( 'The feed answered HTTP %d (a redirect). With a feed token set, redirects are not followed: use the final address.', 'lilahcraft' ), $code ) );
	}
	if ( 200 !== $code ) {
		/* translators: %d: HTTP status code. */
		return new WP_Error( 'lilahcraft_feed', sprintf( __( 'The feed answered HTTP %d.', 'lilahcraft' ), $code ) );
	}
	$json = json_decode( wp_remote_retrieve_body( $res ), true );
	if ( ! is_array( $json ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The feed did not send JSON.', 'lilahcraft' ) );
	}
	return 'market' === $feed ? lilahcraft_clean_market( $json ) : lilahcraft_clean_minis( $json );
}

/**
 * Plain text, trimmed, with Minecraft colour codes removed.
 *
 * @param mixed $s   Value.
 * @param int   $max Longest allowed.
 * @return string
 */
function lilahcraft_text( $s, $max = 80 ) {
	if ( ! is_scalar( $s ) ) {
		return '';
	}
	$s = preg_replace( '/\x{00A7}./u', '', (string) $s );
	$s = trim( wp_strip_all_tags( $s ) );
	return function_exists( 'mb_substr' ) ? mb_substr( $s, 0, $max ) : substr( $s, 0, $max );
}

/**
 * A finite number or null.
 *
 * @param mixed $n Value.
 * @return float|null
 */
function lilahcraft_num( $n ) {
	return ( is_numeric( $n ) && is_finite( (float) $n ) ) ? (float) $n : null;
}

/**
 * A whole number, or $default when the value isn't a number or is too big for an int
 * (casting 1.5e20 to int warns on newer PHP).
 *
 * @param mixed $n       Value.
 * @param mixed $default Fallback.
 * @return int|mixed
 */
function lilahcraft_int( $n, $default = 0 ) {
	$n = lilahcraft_num( $n );
	return ( null !== $n && abs( $n ) < PHP_INT_MAX ) ? (int) round( $n ) : $default;
}

/**
 * A time in ms since 1970, above 0 and no later than $latest, or 0. A time far ahead is a clock or unit
 * slip upstream (micro- or nanoseconds), so it counts as missing.
 *
 * @param mixed $n      Value.
 * @param int   $latest The latest time allowed (ms).
 * @return int
 */
function lilahcraft_time( $n, $latest ) {
	$t = lilahcraft_int( $n, 0 );
	return ( $t > 0 && $t <= $latest ) ? $t : 0;
}

/**
 * A feed id: lower case letters, digits, _ : - and at most 80 of them ('' when there's nothing left).
 *
 * @param mixed $s Value.
 * @return string
 */
function lilahcraft_id( $s ) {
	return is_scalar( $s ) ? substr( preg_replace( '/[^a-z0-9_:\-]/', '', strtolower( (string) $s ) ), 0, 80 ) : '';
}

/**
 * Plain text for the live market's names, headlines and lines: like lilahcraft_text, and the
 * &-style colour codes (&a, &l, &x…) go too.
 *
 * @param mixed $s   Value.
 * @param int   $max Longest allowed.
 * @return string
 */
function lilahcraft_plain( $s, $max ) {
	if ( ! is_scalar( $s ) ) {
		return '';
	}
	// Codes out before and after the tags, so neither can hide the other ("&<b></b>a").
	$code = '/[\x{00A7}&][0-9a-fk-orx]/iu';
	$s    = lilahcraft_text( preg_replace( $code, '', (string) $s ), 1000 );
	return lilahcraft_text( preg_replace( $code, '', $s ), $max );
}

/**
 * A percent (11.7 = +11.7 %): a finite number no further than ±1000 from zero, or null.
 *
 * @param mixed $n Value.
 * @return float|null
 */
function lilahcraft_pct( $n ) {
	$n = lilahcraft_num( $n );
	return ( null !== $n && abs( $n ) <= 1000 ) ? $n : null;
}

/**
 * One of the allowed words (any case in the feed, lower case out), or ''.
 *
 * @param mixed $s       Value.
 * @param array $allowed Lower case words.
 * @return string
 */
function lilahcraft_enum( $s, $allowed ) {
	$s = is_string( $s ) ? strtolower( trim( $s ) ) : '';
	return in_array( $s, $allowed, true ) ? $s : '';
}

/**
 * $a[ $key ] when $a is an array that has it, else null.
 *
 * @param mixed  $a   Value.
 * @param string $key Key.
 * @return mixed
 */
function lilahcraft_field( $a, $key ) {
	return ( is_array( $a ) && isset( $a[ $key ] ) ) ? $a[ $key ] : null;
}

/**
 * Request headers for a feed: JSON, plus the shared secret when Settings > LilahCraft has one
 * (HomeCraftMgmt checks it; visitors never see it).
 *
 * @return array
 */
function lilahcraft_feed_headers() {
	$headers = array( 'Accept' => 'application/json' );
	$token   = (string) lilahcraft_setting( 'feed_token' );
	if ( '' !== $token ) {
		$headers['Authorization'] = 'Bearer ' . $token;
	}
	return $headers;
}

/**
 * Clean a price history: the newest $max points, oldest first, as { t, p, s }.
 *
 * @param mixed $list Points from the feed.
 * @param int   $max  Most points kept.
 * @return array
 */
function lilahcraft_clean_points( $list, $max ) {
	$out = array();
	if ( ! is_array( $list ) ) {
		return $out;
	}
	foreach ( array_slice( $list, -$max ) as $h ) {
		if ( ! is_array( $h ) || null === lilahcraft_num( isset( $h['p'] ) ? $h['p'] : null ) ) {
			continue;
		}
		$out[] = array(
			't' => lilahcraft_int( isset( $h['t'] ) ? $h['t'] : 0 ),
			'p' => (float) $h['p'],
			's' => lilahcraft_int( isset( $h['s'] ) ? $h['s'] : 0 ),
		);
	}
	return $out;
}

/**
 * Keep only the Market fields the site uses.
 *
 * history is the last 48 hours (96 half-hour points). history7d (hourly, up to 168 points) and
 * history30d (every 6 hours, up to 120 points) are kept only when the feed has them and served
 * only with ?long=1; the Market page asks for them and turns its 7D and 30D ranges on when they're there.
 *
 * While HomeCraftMgmt's live market runs (the feed says "live": true) its fields come through too,
 * typed and bounded: per item see lilahcraft_clean_live_item(), at the top level
 * lilahcraft_clean_live_market(). Without "live": true none of them do, so a feed from 0.32 (or 0.33
 * with the live market off) gives exactly 2.1's answer.
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_market( $j ) {
	if ( ! isset( $j['items'] ) || ! is_array( $j['items'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The market feed has no items list.', 'lilahcraft' ) );
	}
	$live  = isset( $j['live'] ) && true === $j['live'];
	$now   = (int) round( microtime( true ) * 1000 );
	$items = array();
	foreach ( $j['items'] as $it ) {
		if ( ! is_array( $it ) || ! isset( $it['id'] ) || ! is_scalar( $it['id'] ) ) {
			continue;
		}
		$id    = lilahcraft_id( $it['id'] );
		$price = lilahcraft_num( isset( $it['price'] ) ? $it['price'] : null );
		if ( '' === $id || null === $price ) {
			continue;
		}
		$history = lilahcraft_clean_points( isset( $it['history'] ) ? $it['history'] : null, 96 );
		$name    = lilahcraft_text( isset( $it['name'] ) ? $it['name'] : '' );
		if ( '' === $name ) {
			// No name: the id in words, as plain text too (so markup in an id never comes along).
			$name = lilahcraft_text( ucwords( str_replace( '_', ' ', strtolower( (string) $it['id'] ) ) ) );
			$name = '' !== $name ? $name : $id;
		}
		$stock   = isset( $it['stock'] ) ? lilahcraft_int( $it['stock'], null ) : null;
		$max     = isset( $it['maxStock'] ) ? lilahcraft_int( $it['maxStock'], null ) : null;
		$items[] = array(
			'id'        => $id,
			'name'      => $name,
			'material'  => substr( preg_replace( '/[^A-Z0-9_]/', '', strtoupper( (string) ( isset( $it['material'] ) && is_scalar( $it['material'] ) ? $it['material'] : $it['id'] ) ) ), 0, 80 ),
			'price'     => $price,
			'buy'       => lilahcraft_num( isset( $it['buy'] ) ? $it['buy'] : null ),
			'sell'      => lilahcraft_num( isset( $it['sell'] ) ? $it['sell'] : null ),
			'stock'     => null === $stock ? null : max( 0, $stock ),
			'maxStock'  => null === $max ? null : max( 0, $max ),
			'change24h' => lilahcraft_num( isset( $it['change24h'] ) ? $it['change24h'] : null ),
			'history'   => $history,
		);
		$last = count( $items ) - 1;
		foreach ( array( 'history7d' => 168, 'history30d' => 120 ) as $key => $max ) {
			$points = lilahcraft_clean_points( isset( $it[ $key ] ) ? $it[ $key ] : null, $max );
			if ( $points ) {
				$items[ $last ][ $key ] = $points;
			}
		}
		if ( $live ) {
			$items[ $last ] += lilahcraft_clean_live_item( $it, $now );
		}
	}
	$refresh = isset( $j['refreshSeconds'] ) ? lilahcraft_int( $j['refreshSeconds'], 30 ) : 30;
	$out     = array(
		'title'          => lilahcraft_text( isset( $j['title'] ) ? $j['title'] : '' ),
		'generatedAt'    => isset( $j['generatedAt'] ) ? lilahcraft_int( $j['generatedAt'] ) : 0,
		'refreshSeconds' => max( 5, min( 3600, $refresh ? $refresh : 30 ) ),
		'items'          => $items,
	);
	return $live ? $out + lilahcraft_clean_live_market( $j, $items, $now ) : $out;
}

/**
 * One item's live-market fields, in the feed's order (each only when the feed has a good one):
 *
 *   usual         number ≥ 0, the price without the mood ("Usually $X")
 *   moodPct       percent against usual now (11.7 = +11.7 %)
 *   status        hot | deal | up | down | wanted, while a badge shows
 *   statusEndsAt  ms, when that badge goes (only with a status; left out when it's more than 60 days ahead)
 *   events        chart markers, oldest first, the newest 20: { t ms, kind: hot|deal|up|down|real, pct };
 *                 a marker more than a day ahead is skipped; served only with ?long=1
 *
 * @param array $it  Feed item.
 * @param int   $now The time now (ms).
 * @return array
 */
function lilahcraft_clean_live_item( $it, $now ) {
	$out   = array();
	$usual = lilahcraft_num( lilahcraft_field( $it, 'usual' ) );
	if ( null !== $usual && $usual >= 0 ) {
		$out['usual'] = $usual;
	}
	$mood = lilahcraft_pct( lilahcraft_field( $it, 'moodPct' ) );
	if ( null !== $mood ) {
		$out['moodPct'] = $mood;
	}
	$status = lilahcraft_enum( lilahcraft_field( $it, 'status' ), array( 'hot', 'deal', 'up', 'down', 'wanted' ) );
	if ( '' !== $status ) {
		$out['status'] = $status;
		$ends          = lilahcraft_time( lilahcraft_field( $it, 'statusEndsAt' ), $now + 60 * DAY_IN_SECONDS * 1000 );
		if ( $ends > 0 ) {
			$out['statusEndsAt'] = $ends;
		}
	}
	$events = array();
	$list   = lilahcraft_field( $it, 'events' );
	foreach ( is_array( $list ) ? $list : array() as $e ) {
		$kind = lilahcraft_enum( lilahcraft_field( $e, 'kind' ), array( 'hot', 'deal', 'up', 'down', 'real' ) );
		$t    = lilahcraft_time( lilahcraft_field( $e, 't' ), $now + DAY_IN_SECONDS * 1000 );
		if ( '' === $kind || $t <= 0 ) {
			continue;
		}
		$pct      = lilahcraft_pct( lilahcraft_field( $e, 'pct' ) );
		$events[] = array(
			't'    => $t,
			'kind' => $kind,
			'pct'  => null === $pct ? 0.0 : $pct,
		);
	}
	if ( $events ) {
		usort(
			$events,
			function ( $a, $b ) {
				return $a['t'] <=> $b['t'];
			}
		);
		$out['events'] = array_slice( $events, -20 );
	}
	return $out;
}

/**
 * The live market's top-level fields, in the feed's order:
 *
 *   live    true
 *   hot     item ids that are HOT, deals: ids on a DEAL (only ids in items, at most 50 each)
 *   season  { id, name, endsAt ms }, left out when there's none (or it ends more than 60 days ahead)
 *   news    the 5 newest rows, newest first, see lilahcraft_clean_news_row()
 *
 * @param array $j     Decoded feed.
 * @param array $items The cleaned items.
 * @param int   $now   The time now (ms).
 * @return array
 */
function lilahcraft_clean_live_market( $j, $items, $now ) {
	$ids = array();
	foreach ( $items as $it ) {
		$ids[ $it['id'] ] = true;
	}
	$out = array( 'live' => true );
	foreach ( array( 'hot', 'deals' ) as $key ) {
		if ( ! isset( $j[ $key ] ) || ! is_array( $j[ $key ] ) ) {
			continue;
		}
		$out[ $key ] = array();
		foreach ( $j[ $key ] as $id ) {
			$id = lilahcraft_id( $id );
			if ( isset( $ids[ $id ] ) && ! in_array( $id, $out[ $key ], true ) && count( $out[ $key ] ) < 50 ) {
				$out[ $key ][] = $id;
			}
		}
	}
	$season = lilahcraft_field( $j, 'season' );
	$sid    = lilahcraft_id( lilahcraft_field( $season, 'id' ) );
	$name   = lilahcraft_plain( lilahcraft_field( $season, 'name' ), 60 );
	$ends   = lilahcraft_time( lilahcraft_field( $season, 'endsAt' ), $now + 60 * DAY_IN_SECONDS * 1000 );
	if ( '' !== $sid && $ends > 0 ) {
		$out['season'] = array(
			'id'     => $sid,
			// A season with no name reads as its id in words, as in game (harvest_time: Harvest Time).
			'name'   => '' !== $name ? $name : substr( ucwords( str_replace( '_', ' ', $sid ) ), 0, 60 ),
			'endsAt' => $ends,
		);
	}
	if ( isset( $j['news'] ) && is_array( $j['news'] ) ) {
		$news = array();
		foreach ( $j['news'] as $row ) {
			$row = lilahcraft_clean_news_row( $row, $ids, $now );
			if ( $row ) {
				$news[] = $row;
			}
		}
		usort(
			$news,
			function ( $a, $b ) {
				return $b['t'] <=> $a['t'];
			}
		);
		$out['news'] = array_slice( $news, 0, 5 );
	}
	return $out;
}

/**
 * One news row, or null when it isn't one the site can show (an unknown kind or source, no id,
 * headline or time, or a time more than a day ahead, which would sit on top as "just now"):
 *
 *   { id int, t ms, kind: up|down|hot|deal|wanted|season|real, item: an id from items or null,
 *     name, dir: 1|-1|0, pct, before and after (money, both or neither), headline, line,
 *     source: sim|admin|calendar|real, active bool }
 *
 * @param mixed $n   Feed row.
 * @param array $ids The cleaned items' ids, as keys.
 * @param int   $now The time now (ms).
 * @return array|null
 */
function lilahcraft_clean_news_row( $n, $ids, $now ) {
	$kind     = lilahcraft_enum( lilahcraft_field( $n, 'kind' ), array( 'up', 'down', 'hot', 'deal', 'wanted', 'season', 'real' ) );
	$source   = lilahcraft_enum( lilahcraft_field( $n, 'source' ), array( 'sim', 'admin', 'calendar', 'real' ) );
	$id       = lilahcraft_int( lilahcraft_field( $n, 'id' ), -1 );
	$t        = lilahcraft_time( lilahcraft_field( $n, 't' ), $now + DAY_IN_SECONDS * 1000 );
	$headline = lilahcraft_plain( lilahcraft_field( $n, 'headline' ), 140 );
	if ( '' === $kind || '' === $source || $id < 0 || $t <= 0 || '' === $headline ) {
		return null;
	}
	$item = 'season' === $kind ? '' : lilahcraft_id( lilahcraft_field( $n, 'item' ) );
	$dir  = lilahcraft_int( lilahcraft_field( $n, 'dir' ), 0 );
	$pct  = lilahcraft_pct( lilahcraft_field( $n, 'pct' ) );
	$row  = array(
		'id'   => $id,
		't'    => $t,
		'kind' => $kind,
		'item' => ( '' !== $item && isset( $ids[ $item ] ) ) ? $item : null,
		'name' => lilahcraft_plain( lilahcraft_field( $n, 'name' ), 60 ),
		'dir'  => $dir > 0 ? 1 : ( $dir < 0 ? -1 : 0 ),
		'pct'  => null === $pct ? 0.0 : $pct,
	);
	$before = lilahcraft_num( lilahcraft_field( $n, 'before' ) );
	$after  = lilahcraft_num( lilahcraft_field( $n, 'after' ) );
	if ( null !== $before && null !== $after && $before >= 0 && $after >= 0 ) {
		$row['before'] = $before;
		$row['after']  = $after;
	}
	$row['headline'] = $headline;
	$row['line']     = lilahcraft_plain( lilahcraft_field( $n, 'line' ), 200 );
	$row['source']   = $source;
	$row['active']   = true === lilahcraft_field( $n, 'active' );
	return $row;
}

/**
 * A skin URL from Mojang's texture server, or null. Anything else is dropped.
 *
 * @param mixed $url Value.
 * @return string|null
 */
function lilahcraft_clean_skin( $url ) {
	if ( ! is_string( $url ) ) {
		return null;
	}
	$url = preg_replace( '#^http://#i', 'https://', trim( $url ) );
	return preg_match( '#^https://textures\.minecraft\.net/texture/[0-9a-fA-F]{16,128}$#', $url ) ? $url : null;
}

/**
 * Keep only the Minis fields the site uses. No owners, no holders, counts only.
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_minis( $j ) {
	if ( ! isset( $j['minis'] ) || ! is_array( $j['minis'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The Minis feed has no minis list.', 'lilahcraft' ) );
	}
	$minis = array();
	foreach ( $j['minis'] as $m ) {
		if ( ! is_array( $m ) || ! isset( $m['id'] ) || ! is_scalar( $m['id'] ) ) {
			continue;
		}
		$id = lilahcraft_id( $m['id'] );
		if ( '' === $id ) {
			continue;
		}
		$cap     = isset( $m['cap'] ) ? lilahcraft_int( $m['cap'], -1 ) : -1;
		$printed = isset( $m['printed'] ) ? max( 0, lilahcraft_int( $m['printed'] ) ) : 0;
		$row     = array(
			'id'       => $id,
			'name'     => lilahcraft_text( isset( $m['name'] ) ? $m['name'] : $m['id'] ),
			'rarity'   => substr( preg_replace( '/[^A-Z_]/', '', strtoupper( (string) ( isset( $m['rarity'] ) && is_scalar( $m['rarity'] ) ? $m['rarity'] : 'COMMON' ) ) ), 0, 20 ),
			'category' => substr( preg_replace( '/[^A-Z_]/', '', strtoupper( (string) ( isset( $m['category'] ) && is_scalar( $m['category'] ) ? $m['category'] : 'MISC' ) ) ), 0, 30 ),
			'series'   => lilahcraft_text( isset( $m['series'] ) ? $m['series'] : '' ),
			'cap'      => $cap < 0 ? -1 : $cap,
			'printed'  => $printed,
			'soldOut'  => ! empty( $m['soldOut'] ) || ( $cap > 0 && $printed >= $cap ),
		);
		$skin = lilahcraft_clean_skin( isset( $m['skin'] ) ? $m['skin'] : null );
		if ( $skin ) {
			$row['skin'] = $skin;
		}
		$minis[] = $row;
	}
	return array(
		'generatedAt' => isset( $j['generatedAt'] ) ? lilahcraft_int( $j['generatedAt'] ) : 0,
		'minis'       => $minis,
	);
}
