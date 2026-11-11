<?php
/**
 * Same-origin REST routes for the live data.
 *
 *   GET /wp-json/lilahcraft/v1/market            the Market feed (HomeCraftMgmt /api/market) as a summary: every
 *                                                item with its prices, stock, department and a 24-point sparkline,
 *                                                the department tabs, the LCX index and the live market's tags,
 *                                                season and news. No price history (lilahcraft_market_summary())
 *   GET /wp-json/lilahcraft/v1/market?item=<id>  one item: its summary fields plus history, history7d, history30d
 *                                                and the chart markers (events); { "missing": true } for an id the
 *                                                feed doesn't have (lilahcraft_market_item())
 *   GET /wp-json/lilahcraft/v1/minis             the Minis feed  (HomeCraftMgmt /api/minis)
 *   GET /wp-json/lilahcraft/v1/arcade            the Arcade feed (HomeCraftMgmt /api/arcade: games, odds, records
 *                                                and leaderboards, Fresh Courses, the Weekly Cup, today's pick, the
 *                                                Star Chart, the Prize Counter, Card Packs, achievements, and from
 *                                                0.38.8 the reward rules, the Clubhouse and the holidays)
 *   GET /wp-json/lilahcraft/v1/status            { online, players, max, version }
 *
 * The cleaners read HomeCraftMgmt 0.38.8's feeds and 0.38.7's alike: what 0.38.8 adds (the Market's departments,
 * a holiday Mini's dates, the Arcade's rules, clubhouse and holidays, the Ice Boat's track) is passed on when the
 * feed has it and is simply absent when it doesn't, except the Market's "departments" and each item's
 * "department", which the site then fills in itself (inc/departments.php).
 *
 * WordPress fetches each feed, keeps it in a transient for the configured seconds and keeps the
 * last good copy in an option. A failed fetch serves that copy with "stale": true. With no URL set,
 * or nothing good yet, the answer is { "sample": true } and the page shows labelled sample data.
 * Only whitelisted fields are passed on.
 *
 * The Market feed is a few MB for a few hundred items, nearly all of it price history. So the summary is
 * built once, when the feed is fetched, and is what gets cached and served; the histories are stored apart,
 * spread over a few options by item id, and one of those is read when a visitor charts an item.
 * The live market's fields (HomeCraftMgmt 0.33) only come through while the feed says "live": true.
 * The Arcade feed's URL may be left blank: it then follows the Market feed URL (lilahcraft_feed_url()).
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require_once __DIR__ . '/departments.php';

add_action(
	'rest_api_init',
	function () {
		foreach ( array( 'market', 'minis', 'arcade', 'status' ) as $route ) {
			register_rest_route(
				'lilahcraft/v1',
				'/' . $route,
				array(
					'methods'             => 'GET',
					'permission_callback' => '__return_true',
					'callback'            => function ( WP_REST_Request $request ) use ( $route ) {
						$data = 'status' === $route ? lilahcraft_server_status() : lilahcraft_get_feed( $route );
						// ?item=<id>: one item with its price history, for the Market page's chart.
						if ( 'market' === $route && null !== $request->get_param( 'item' ) ) {
							$data = lilahcraft_market_item( $data, $request->get_param( 'item' ) );
						}
						return lilahcraft_rest_response( $data, $request );
					},
				)
			);
		}
	}
);

/**
 * How each feed's stored copy is laid out. Raised when a release changes what the cleaner keeps, so a copy an older
 * version of the theme stored (the whole market with its history, a summary without its departments, an Arcade
 * without its Fresh Courses or its rules) is fetched again instead of being served.
 *
 * @param string $feed market, minis or arcade.
 * @return int
 */
function lilahcraft_feed_format( $feed ) {
	return 'minis' === $feed ? 2 : 3;
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
 * @param string $feed market, minis or arcade.
 * @return array
 */
function lilahcraft_get_feed( $feed ) {
	$url = lilahcraft_feed_url( $feed );
	if ( '' === $url ) {
		return array( 'sample' => true );
	}

	// Copies are stored with their format. One from an older version of the theme counts as missing, and is deleted
	// on sight: 2.1's whole market is megabytes, better not held in memory while the feed is fetched again.
	$format = lilahcraft_feed_format( $feed );
	$cached = get_transient( 'lilahcraft_feed_' . $feed );
	if ( is_array( $cached ) && isset( $cached['format'], $cached['data'] ) && $format === $cached['format'] && is_array( $cached['data'] ) ) {
		return $cached['data'];
	}
	if ( false !== $cached ) {
		delete_transient( 'lilahcraft_feed_' . $feed );
	}
	unset( $cached );

	$ttl  = max( 5, (int) lilahcraft_setting( 'cache_seconds' ) );
	$last = get_option( 'lilahcraft_last_' . $feed );
	if ( is_array( $last ) && ( isset( $last['format'] ) ? $last['format'] : 1 ) !== $format ) {
		delete_option( 'lilahcraft_last_' . $feed );
		$last = null;
	}
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
		if ( 'market' === $feed ) {
			// The summary is what is cached and served. Each item's history is stored apart, for ?item=<id>.
			lilahcraft_store_market_history( $fresh, $url );
			$fresh = lilahcraft_market_summary( $fresh );
		}
		$fresh['stale']     = false;
		$fresh['fetchedAt'] = (int) round( microtime( true ) * 1000 );
		update_option(
			'lilahcraft_last_' . $feed,
			array(
				'url'    => $url,
				'data'   => $fresh,
				'format' => $format,
			),
			false
		);
		lilahcraft_note_feed( $feed, true, '', $url );
		lilahcraft_cache_feed( $feed, $fresh, $ttl );
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
	lilahcraft_cache_feed( $feed, $out, min( $ttl, 30 ) );
	return $out;
}

/**
 * Keep a feed's answer for $seconds, with the format it was stored in.
 *
 * @param string $feed    market, minis or arcade.
 * @param array  $data    The answer.
 * @param int    $seconds How long.
 */
function lilahcraft_cache_feed( $feed, $data, $seconds ) {
	set_transient(
		'lilahcraft_feed_' . $feed,
		array(
			'format' => lilahcraft_feed_format( $feed ),
			'data'   => $data,
		),
		$seconds
	);
}

/**
 * How many options the items' price histories are spread over, by a hash of the item id. With a few hundred
 * items each holds about a sixteenth of the history, so charting one item reads a few hundred KB, not the lot.
 */
const LILAHCRAFT_HISTORY_BUCKETS = 16;

/**
 * The option that holds an item's price history.
 *
 * @param string $id A cleaned item id.
 * @return string
 */
function lilahcraft_history_option( $id ) {
	// crc32() can be negative on a 32-bit PHP: the low bits are the same either way.
	return 'lilahcraft_market_history_' . ( crc32( (string) $id ) & ( LILAHCRAFT_HISTORY_BUCKETS - 1 ) );
}

/**
 * Store every item's history, history7d, history30d and chart markers (events) from a cleaned Market feed, as JSON
 * text in LILAHCRAFT_HISTORY_BUCKETS options (not autoloaded). They belong to the feed address they came from.
 *
 * @param array  $market The cleaned feed (lilahcraft_clean_market()).
 * @param string $url    The feed's address.
 */
function lilahcraft_store_market_history( $market, $url ) {
	$buckets = array();
	foreach ( $market['items'] as $it ) {
		$detail = array( 'history' => $it['history'] );
		foreach ( array( 'history7d', 'history30d', 'events' ) as $key ) {
			if ( isset( $it[ $key ] ) ) {
				$detail[ $key ] = $it[ $key ];
			}
		}
		$buckets[ lilahcraft_history_option( $it['id'] ) ][ $it['id'] ] = $detail;
	}
	for ( $n = 0; $n < LILAHCRAFT_HISTORY_BUCKETS; $n++ ) {
		$option = 'lilahcraft_market_history_' . $n;
		update_option(
			$option,
			wp_json_encode(
				array(
					'url'   => $url,
					'items' => isset( $buckets[ $option ] ) ? $buckets[ $option ] : array(),
				)
			),
			false
		);
	}
}

/**
 * One item's stored history: { history, history7d?, history30d?, events? }, as lilahcraft_clean_market() made them.
 * An item with nothing stored for this feed address has an empty history.
 *
 * @param string $id  A cleaned item id.
 * @param string $url The feed's address.
 * @return array
 */
function lilahcraft_market_history( $id, $url ) {
	$stored = get_option( lilahcraft_history_option( $id ) );
	$bucket = is_string( $stored ) ? json_decode( $stored, true ) : null;
	if ( ! is_array( $bucket ) || ! isset( $bucket['url'], $bucket['items'][ $id ]['history'] ) || $bucket['url'] !== $url ) {
		return array( 'history' => array() );
	}
	return $bucket['items'][ $id ];
}

/**
 * The Market feed as the pages load it: everything about each item but its price history, which is most of the feed.
 *
 *   title, generatedAt, refreshSeconds
 *   items        [ { id, name, material, department, price, buy, sell, stock, maxStock, change24h,
 *                    usual?, moodPct?, status?, statusEndsAt?  (the live market, see lilahcraft_clean_live_item()),
 *                    spark } ]: spark is the last 24 hours as 24 prices, see lilahcraft_market_spark()
 *   departments  the department tabs in order, always: the feed's own, or the eight in inc/departments.php.
 *                Every item's department is one of them
 *   index        the LCX index over the last 24 hours, [ { t, v } ], see lilahcraft_market_index()
 *   live, hot, deals, season, news   only while the live market runs (lilahcraft_clean_live_market())
 *
 * @param array $market The cleaned feed (lilahcraft_clean_market()).
 * @return array
 */
function lilahcraft_market_summary( $market ) {
	$items = array();
	foreach ( $market['items'] as $it ) {
		$prices = array();
		foreach ( $it['history'] as $h ) {
			$prices[] = $h['p'];
		}
		unset( $it['history'], $it['history7d'], $it['history30d'], $it['events'] );
		$it['spark'] = lilahcraft_market_spark( $prices );
		$items[]     = $it;
	}
	$out = array(
		'title'          => $market['title'],
		'generatedAt'    => $market['generatedAt'],
		'refreshSeconds' => $market['refreshSeconds'],
		'items'          => $items,
		'departments'    => $market['departments'],
		'index'          => lilahcraft_market_index( $market['items'] ),
	);
	foreach ( array( 'live', 'hot', 'deals', 'season', 'news' ) as $key ) {
		if ( isset( $market[ $key ] ) ) {
			$out[ $key ] = $market[ $key ];
		}
	}
	return $out;
}

/**
 * An item's sparkline: the last 24 hours (the newest 49 half-hour prices, the span of change24h) as at most 24
 * prices, oldest first. A longer run is split into 24 parts and each part averaged, keeping the real first and
 * last price, as the Home board always drew it. Four decimals.
 *
 * @param float[] $prices The history's prices, oldest first.
 * @return float[]
 */
function lilahcraft_market_spark( $prices ) {
	$prices = array_slice( $prices, -49 );
	$n      = count( $prices );
	$out    = $prices;
	if ( $n > 24 ) {
		$out = array();
		for ( $i = 0; $i < 24; $i++ ) {
			$from  = intdiv( $i * $n, 24 );
			$to    = intdiv( ( $i + 1 ) * $n, 24 );
			$out[] = array_sum( array_slice( $prices, $from, $to - $from ) ) / ( $to - $from );
		}
		$out[0]  = $prices[0];
		$out[23] = $prices[ $n - 1 ];
	}
	foreach ( $out as $i => $p ) {
		$out[ $i ] = round( $p, 4 );
	}
	return $out;
}

/**
 * The LCX index over the last 24 hours, [ { t, v } ] oldest first: at each half-hour snapshot, 1000 times the
 * average of every counted item's price against its own price at the start. Counted: items in stock that have a
 * 24h change and at least two prices; the span is the shortest history among them, 49 points at most. This is the
 * sum the Market page did in the browser through 2.1 (same items, same order, same arithmetic), now done once per
 * fetch. t is the snapshot's time, read from the first counted item. [] when nothing can be counted.
 *
 * @param array $items The cleaned items, with their history.
 * @return array
 */
function lilahcraft_market_index( $items ) {
	$use = array();
	foreach ( $items as $it ) {
		$sold_out = null !== $it['stock'] && $it['stock'] <= 0;
		if ( ! $sold_out && null !== $it['change24h'] && count( $it['history'] ) >= 2 ) {
			$use[] = $it['history'];
		}
	}
	if ( ! $use ) {
		return array();
	}
	$len = 49;
	foreach ( $use as $history ) {
		$len = min( $len, count( $history ) );
	}
	$index = array();
	for ( $j = 0; $j < $len; $j++ ) {
		$sum = 0;
		foreach ( $use as $history ) {
			$first = count( $history ) - $len;
			$base  = $history[ $first ]['p'];
			$sum  += $base > 0 ? $history[ $first + $j ]['p'] / $base - 1 : 0;
		}
		$index[] = array(
			't' => $use[0][ count( $use[0] ) - $len + $j ]['t'],
			'v' => 1000 * ( 1 + $sum / count( $use ) ),
		);
	}
	return $index;
}

/**
 * The answer to ?item=<id>: { generatedAt, item, departments, stale, fetchedAt }, where item is the summary's
 * record for that id plus its stored history: history (the last 48 hours), and history7d, history30d and events
 * when the feed has them; departments is the summary's (the tabs, of which the item's department is one).
 * { "missing": true } for anything that isn't exactly an id in the feed. Without a feed (the answer is
 * { "sample": true }) it is passed on as it is, and the page charts its sample item.
 *
 * @param array $data The summary, as lilahcraft_get_feed( 'market' ) gives it.
 * @param mixed $id   The id asked for.
 * @return array
 */
function lilahcraft_market_item( $data, $id ) {
	if ( ! isset( $data['items'] ) || ! is_array( $data['items'] ) ) {
		return $data;
	}
	foreach ( $data['items'] as $it ) {
		if ( $it['id'] === $id ) {
			return array(
				'generatedAt' => $data['generatedAt'],
				'item'        => $it + lilahcraft_market_history( $id, lilahcraft_feed_url( 'market' ) ),
				'departments' => isset( $data['departments'] ) ? $data['departments'] : lilahcraft_departments(),
				'stale'       => ! empty( $data['stale'] ),
				'fetchedAt'   => isset( $data['fetchedAt'] ) ? $data['fetchedAt'] : 0,
			);
		}
	}
	return array( 'missing' => true );
}

/**
 * Remember how the last fetch went, for the settings page.
 *
 * @param string $feed  market, minis or arcade.
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
 * @param string $feed market, minis or arcade.
 * @param string $url  Feed URL.
 * @return array|WP_Error
 */
function lilahcraft_fetch_feed( $feed, $url ) {
	// WordPress sends the same headers on to wherever a redirect points (another host, plain http),
	// so with a feed token set, redirects are not followed.
	$token = '' !== (string) lilahcraft_setting( 'feed_token' );
	/**
	 * Seconds to wait for a feed. The market feed is a few MB for a few hundred items; a failed
	 * fetch still serves the last good copy.
	 *
	 * @param int    $seconds Default 8.
	 * @param string $feed    market, minis or arcade.
	 */
	$timeout = max( 2, (int) apply_filters( 'lilahcraft_feed_timeout', 8, $feed ) );
	$res     = wp_remote_get(
		$url,
		array(
			'timeout'     => $timeout,
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
	if ( 'arcade' === $feed ) {
		return lilahcraft_clean_arcade( $json );
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
 * A time in ms since 1970, above 0 (or no earlier than $earliest) and no later than $latest, or 0. A time far
 * ahead is a clock or unit slip upstream (micro- or nanoseconds), so it counts as missing; so does one before
 * $earliest where a date is printed (a time in seconds reads as January 1970).
 *
 * @param mixed $n        Value.
 * @param int   $latest   The latest time allowed (ms).
 * @param int   $earliest The earliest time allowed (ms).
 * @return int
 */
function lilahcraft_time( $n, $latest, $earliest = 1 ) {
	$t = lilahcraft_int( $n, 0 );
	return ( $t >= $earliest && $t <= $latest ) ? $t : 0;
}

/**
 * 1 January 2020 (ms): before the server existed. The earliest a printed date (a holiday, a holiday Mini's
 * window) can be.
 */
const LILAHCRAFT_EARLIEST_DATE = 1577836800000;

/**
 * $n when the feed sent it as a JSON number, else null: for the fields HomeCraftMgmt 0.38.8 added, where a
 * number in quotes, true or a list is not a number.
 *
 * @param mixed $n Value.
 * @return int|float|null
 */
function lilahcraft_json_number( $n ) {
	return ( is_int( $n ) || is_float( $n ) ) ? $n : null;
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
 * A department's name as plain text on one line: colour codes and markup gone, at most 30 characters
 * ('' when it isn't text or nothing is left).
 *
 * @param mixed $s Value.
 * @return string
 */
function lilahcraft_department_name( $s ) {
	return is_string( $s ) ? lilahcraft_arcade_text( $s, 30 ) : '';
}

/**
 * The Market's department tabs from the feed's "departments" (HomeCraftMgmt 0.38.8): the names in the feed's
 * order, each as lilahcraft_department_name() makes it, blanks and repeats (in any case) dropped, 24 at most
 * (the game shows eight; the feed lists a ninth and later one too). [] when the feed has none (0.38.7) or
 * nothing usable in it: the Market then has the eight tabs in inc/departments.php.
 *
 * @param mixed $list The feed's departments.
 * @return string[]
 */
function lilahcraft_clean_departments( $list ) {
	$tabs = array();
	foreach ( lilahcraft_list( $list ) as $name ) {
		$name = lilahcraft_department_name( $name );
		if ( '' !== $name && '' === lilahcraft_department_match( $name, $tabs ) && count( $tabs ) < 24 ) {
			$tabs[] = $name;
		}
	}
	return $tabs;
}

/**
 * Keep only the Market fields the site uses: the whole feed, cleaned. lilahcraft_get_feed() then stores its
 * histories (lilahcraft_store_market_history()) and serves the rest (lilahcraft_market_summary()).
 *
 * departments is always there: the department tabs in order. They are the feed's own "departments" from
 * HomeCraftMgmt 0.38.8 (lilahcraft_clean_departments()), and the eight the plugin ships when the feed sends none.
 * Each item id comes through once (the first one wins), with its department: the feed's "department" for it when
 * that is one of the tabs, otherwise the site's own answer (lilahcraft_department()). Always one of the tabs.
 * history is the last 48 hours (96 half-hour points). history7d (hourly, up to 168 points) and
 * history30d (every 6 hours, up to 120 points) are kept only when the feed has them; the Market page turns
 * its 7D and 30D ranges on for an item that has them.
 *
 * While HomeCraftMgmt's live market runs (the feed says "live": true) its fields come through too,
 * typed and bounded: per item see lilahcraft_clean_live_item(), at the top level
 * lilahcraft_clean_live_market(). Without "live": true none of them do.
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_market( $j ) {
	if ( ! isset( $j['items'] ) || ! is_array( $j['items'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The market feed has no items list.', 'lilahcraft' ) );
	}
	// For a moment after it starts HomeCraftMgmt answers { "items": [] } and nothing else. That isn't an empty
	// market: keep the last good copy instead of caching it.
	if ( ! $j['items'] && ! isset( $j['generatedAt'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The market feed is not ready yet (HomeCraftMgmt has just started).', 'lilahcraft' ) );
	}
	$live  = isset( $j['live'] ) && true === $j['live'];
	$now   = (int) round( microtime( true ) * 1000 );
	$tabs  = lilahcraft_clean_departments( lilahcraft_field( $j, 'departments' ) );
	$tabs  = $tabs ? $tabs : lilahcraft_departments();
	$items = array();
	$seen  = array();
	foreach ( $j['items'] as $it ) {
		if ( ! is_array( $it ) || ! isset( $it['id'] ) || ! is_scalar( $it['id'] ) ) {
			continue;
		}
		$id    = lilahcraft_id( $it['id'] );
		$price = lilahcraft_num( isset( $it['price'] ) ? $it['price'] : null );
		if ( '' === $id || null === $price || isset( $seen[ $id ] ) ) {
			continue;
		}
		$seen[ $id ] = true;
		$history     = lilahcraft_clean_points( isset( $it['history'] ) ? $it['history'] : null, 96 );
		$name    = lilahcraft_text( isset( $it['name'] ) ? $it['name'] : '' );
		if ( '' === $name ) {
			// No name: the id in words, as plain text too (so markup in an id never comes along).
			$name = lilahcraft_text( ucwords( str_replace( '_', ' ', strtolower( (string) $it['id'] ) ) ) );
			$name = '' !== $name ? $name : $id;
		}
		$stock    = isset( $it['stock'] ) ? lilahcraft_int( $it['stock'], null ) : null;
		$max      = isset( $it['maxStock'] ) ? lilahcraft_int( $it['maxStock'], null ) : null;
		$material = substr( preg_replace( '/[^A-Z0-9_]/', '', strtoupper( (string) ( isset( $it['material'] ) && is_scalar( $it['material'] ) ? $it['material'] : $it['id'] ) ) ), 0, 80 );
		$items[]  = array(
			'id'         => $id,
			'name'       => $name,
			'material'   => $material,
			'department' => lilahcraft_department( $material, lilahcraft_department_name( lilahcraft_field( $it, 'department' ) ), $tabs ),
			'price'      => $price,
			'buy'        => lilahcraft_num( isset( $it['buy'] ) ? $it['buy'] : null ),
			'sell'       => lilahcraft_num( isset( $it['sell'] ) ? $it['sell'] : null ),
			'stock'      => null === $stock ? null : max( 0, $stock ),
			'maxStock'   => null === $max ? null : max( 0, $max ),
			'change24h'  => lilahcraft_num( isset( $it['change24h'] ) ? $it['change24h'] : null ),
			'history'    => $history,
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
		'departments'    => $tabs,
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
 *                 a marker more than a day ahead is skipped; served only with the item (?item=<id>)
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
 *   season  { id, name, endsAt ms }, left out when there's none (or it ends more than a year ahead: the shipped
 *           seasons run up to three months, Cozy Winter from 1 December to 28 February)
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
	$ends   = lilahcraft_time( lilahcraft_field( $season, 'endsAt' ), $now + 366 * DAY_IN_SECONDS * 1000 );
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
 * Keep only the Minis fields the site uses. No owners, no holders, counts only:
 *
 *   { id, name, rarity, category, series, cap, printed, soldOut, skin? }
 *
 * and on a holiday Mini (HomeCraftMgmt 0.38.8), after those:
 *
 *   eventOnly  true: it is earned at its own event, never from a pack, a Card, the Mini Printer or a drop. Only
 *              ever true: any other value is not passed on, and neither are the dates then
 *   earnFrom,  the first and the last millisecond it can be earned (ms; the days are the server's, so they are
 *   earnTo     formatted in the server's time zone). Both or neither: left out when either isn't a time from
 *              2020 to two years ahead, or they are back to front
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_minis( $j ) {
	if ( ! isset( $j['minis'] ) || ! is_array( $j['minis'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The Minis feed has no minis list.', 'lilahcraft' ) );
	}
	// As for the market: { "minis": [] } alone is HomeCraftMgmt still starting, not an empty catalogue.
	if ( ! $j['minis'] && ! isset( $j['generatedAt'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The Minis feed is not ready yet (HomeCraftMgmt has just started).', 'lilahcraft' ) );
	}
	// A holiday Mini's window is a catalogue fact, so it can lie well ahead: up to two years.
	$latest = (int) round( microtime( true ) * 1000 ) + 2 * 366 * DAY_IN_SECONDS * 1000;
	$minis  = array();
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
		if ( true === lilahcraft_field( $m, 'eventOnly' ) ) {
			$row['eventOnly'] = true;
			$from             = lilahcraft_time( lilahcraft_json_number( lilahcraft_field( $m, 'earnFrom' ) ), $latest, LILAHCRAFT_EARLIEST_DATE );
			$to               = lilahcraft_time( lilahcraft_json_number( lilahcraft_field( $m, 'earnTo' ) ), $latest, LILAHCRAFT_EARLIEST_DATE );
			if ( $from > 0 && $to >= $from ) {
				$row['earnFrom'] = $from;
				$row['earnTo']   = $to;
			}
		}
		$minis[] = $row;
	}
	return array(
		'generatedAt' => isset( $j['generatedAt'] ) ? lilahcraft_int( $j['generatedAt'] ) : 0,
		'minis'       => $minis,
	);
}

/**
 * A whole number from $min to $max, or null (not a number, not whole, or out of range).
 *
 * @param mixed $n   Value.
 * @param int   $min Smallest allowed.
 * @param int   $max Largest allowed.
 * @return int|null
 */
function lilahcraft_whole( $n, $min, $max ) {
	$n = lilahcraft_num( $n );
	return ( null !== $n && floor( $n ) === $n && $n >= $min && $n <= $max ) ? (int) $n : null;
}

/**
 * $a when it is a JSON list ([…]), else an empty array.
 *
 * @param mixed $a Value.
 * @return array
 */
function lilahcraft_list( $a ) {
	return ( is_array( $a ) && array_keys( $a ) === range( 0, count( $a ) - 1 ) ) ? $a : array();
}

/**
 * $a when it is a JSON object ({…}), else an empty array. (A list would turn its positions into stakes.)
 *
 * @param mixed $a Value.
 * @return array
 */
function lilahcraft_object( $a ) {
	return ( is_array( $a ) && ! lilahcraft_list( $a ) ) ? $a : array();
}

/**
 * One line of Arcade text: plain text as lilahcraft_plain(), with line breaks and control characters
 * turned into single spaces.
 *
 * @param mixed $s   Value.
 * @param int   $max Longest allowed.
 * @return string
 */
function lilahcraft_arcade_text( $s, $max ) {
	return trim( (string) preg_replace( '/[\s\x00-\x1F\x7F]+/u', ' ', lilahcraft_plain( $s, $max ) ) );
}

/**
 * A name for something the feed left unnamed: its id in words (river_run: River Run).
 *
 * @param string $id A cleaned id.
 * @return string
 */
function lilahcraft_id_words( $id ) {
	return substr( ucwords( str_replace( array( '_', '-', ':' ), ' ', $id ) ), 0, 60 );
}

/**
 * A record holder's name, or '' to leave it out: a Java or Bedrock player name (letters, digits, _ . * - and
 * spaces, at most 32), never a UUID. HomeCraftMgmt only sends one while its owner has names switched on.
 *
 * @param mixed $s Value.
 * @return string
 */
function lilahcraft_arcade_holder( $s ) {
	$name = lilahcraft_arcade_text( $s, 200 );
	return ( preg_match( '/^[\p{L}\p{N}_.*\- ]{1,32}$/u', $name ) && ! preg_match( '/[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/i', $name ) ) ? $name : '';
}

/**
 * A day as the Arcade feed writes one, "2026-11-09" (a real date), or ''.
 *
 * @param mixed $s Value.
 * @return string
 */
function lilahcraft_arcade_day( $s ) {
	return ( is_string( $s ) && preg_match( '/^(20\d\d)-(\d\d)-(\d\d)$/D', $s, $m ) && checkdate( (int) $m[2], (int) $m[3], (int) $m[1] ) ) ? $s : '';
}

/**
 * A Fresh course's code as players read it off its tile, "HARD-40" (a slot word, a dash, the edition number;
 * upper case out), or ''.
 *
 * @param mixed $s Value.
 * @return string
 */
function lilahcraft_arcade_code( $s ) {
	$s = is_string( $s ) ? strtoupper( trim( $s ) ) : '';
	return preg_match( '/^[A-Z]{2,8}-[1-9][0-9]{0,8}$/D', $s ) ? $s : '';
}

/**
 * Keep only the Arcade fields the site shows, in the feed's order. HomeCraftMgmt's writer owns the format
 * (ArcadeFeed.java, 0.38.8; a 0.38.7 feed is the same without the last three keys); this rebuilds every object
 * from its documented keys, typed and bounded, so nothing else reaches a visitor, at any depth:
 *
 *   generatedAt   ms, always
 *   games         open games in the feed's order, each id once (the first one wins): see lilahcraft_clean_arcade_game()
 *   featured      { game, until ms }: today's pick: a skill game or course that is in games (never a game of chance),
 *                 or "trials" (every open parkour, elytra, boat and dropper course) / "golf" (every open golf course)
 *   starChart     { week: the Fresh Courses week's first day, best?: the most stars anyone has that week, holder? }
 *   jackpots      [ { game, tokens } ]: a pot, only for a game of chance in games with its paytable (never without odds)
 *   prizes        [ { id, name, category: boosts|hunt|cosmetics|looks|perks|trophies|minis|keepers, cost, description? } ]
 *   packs         [ { id, name, cost, odds: { COMMON|UNCOMMON|RARE|EPIC|LEGENDARY: percent } } ], odds adding up to 100
 *   achievements  [ { id, name, description, tokens } ]; none about a jackpot (a game of chance is never advertised)
 *   rules         the token amounts and caps the games pay by: see lilahcraft_clean_arcade_rules()
 *   clubhouse     { open: true } while the Clubhouse takes visitors; any other value is not passed on. A feed
 *                 that has rules and no clubhouse says the Clubhouse is closed; a feed with neither (0.38.7)
 *                 doesn't say
 *   holidays      [ { id, name, from, to } ]: see lilahcraft_clean_arcade_holidays()
 *
 * The feed's freshHistory (past Fresh courses) and events (Race Night) aren't shown anywhere yet, so they aren't
 * passed on. A section with nothing left in it is left out, as the feed does. Text is one plain line with the
 * colour codes gone. A JSON answer without generatedAt isn't the arcade feed.
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_arcade( $j ) {
	$generated = lilahcraft_int( lilahcraft_field( $j, 'generatedAt' ), 0 );
	// The easy mistake: the Market or Minis address in the Arcade field. Those have a generatedAt too, and would
	// read as an Arcade with nothing on.
	$other = null !== lilahcraft_field( $j, 'items' ) || null !== lilahcraft_field( $j, 'minis' );
	if ( $other && null === lilahcraft_field( $j, 'games' ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'That address sends the Market or Minis feed, not the arcade feed: use the /api/arcade address.', 'lilahcraft' ) );
	}
	if ( $generated <= 0 ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The arcade feed has no generatedAt.', 'lilahcraft' ) );
	}
	$now   = (int) round( microtime( true ) * 1000 );
	$out   = array( 'generatedAt' => $generated );
	$games = array();
	foreach ( lilahcraft_list( lilahcraft_field( $j, 'games' ) ) as $g ) {
		$g = lilahcraft_clean_arcade_game( $g, $now );
		if ( $g && ! isset( $games[ $g['id'] ] ) && count( $games ) < 200 ) {
			$games[ $g['id'] ] = $g;
		}
	}
	if ( $games ) {
		$out['games'] = array_values( $games );
	}

	// The pick changes at the server's next midnight: an end more than two days away is a clock or unit slip.
	// The pick can also be a whole world game an admin pinned: "trials" (every parkour, elytra, boat and dropper
	// course) or "golf" (every golf course), shown only while at least one course of that kind is open.
	$f     = lilahcraft_field( $j, 'featured' );
	$pick  = lilahcraft_id( lilahcraft_field( $f, 'game' ) );
	$until = lilahcraft_time( lilahcraft_field( $f, 'until' ), $now + 2 * DAY_IN_SECONDS * 1000 );
	$kinds = array(
		'trials' => array( 'parkour', 'elytra', 'boat', 'dropper' ),
		'golf'   => array( 'golf' ),
	);
	$whole = false;
	if ( isset( $kinds[ $pick ] ) && ! isset( $games[ $pick ] ) ) {
		foreach ( $games as $g ) {
			$whole = $whole || in_array( $g['kind'], $kinds[ $pick ], true );
		}
	}
	if ( ( $whole || ( isset( $games[ $pick ] ) && 'chance' !== $games[ $pick ]['kind'] ) ) && $until > 0 ) {
		$out['featured'] = array(
			'game'  => $pick,
			'until' => $until,
		);
	}

	// The Star Chart: no best until someone has stars that week, and a holder only beside a best.
	$chart = lilahcraft_field( $j, 'starChart' );
	$week  = lilahcraft_arcade_day( lilahcraft_field( $chart, 'week' ) );
	if ( '' !== $week ) {
		$out['starChart'] = array( 'week' => $week );
		$best             = lilahcraft_whole( lilahcraft_field( $chart, 'best' ), 0, 100000 );
		if ( null !== $best ) {
			$out['starChart']['best'] = $best;
			$holder                   = lilahcraft_arcade_holder( lilahcraft_field( $chart, 'holder' ) );
			if ( '' !== $holder ) {
				$out['starChart']['holder'] = $holder;
			}
		}
	}

	$pots = array();
	foreach ( lilahcraft_list( lilahcraft_field( $j, 'jackpots' ) ) as $p ) {
		$gid    = lilahcraft_id( lilahcraft_field( $p, 'game' ) );
		$tokens = lilahcraft_whole( lilahcraft_field( $p, 'tokens' ), 0, 1000000000 );
		if ( null !== $tokens && isset( $games[ $gid ]['paytable'] ) && ! isset( $pots[ $gid ] ) && count( $pots ) < 10 ) {
			$pots[ $gid ] = array(
				'game'   => $gid,
				'tokens' => $tokens,
			);
		}
	}
	if ( $pots ) {
		$out['jackpots'] = array_values( $pots );
	}

	$prizes = array();
	foreach ( lilahcraft_list( lilahcraft_field( $j, 'prizes' ) ) as $p ) {
		$id       = lilahcraft_id( lilahcraft_field( $p, 'id' ) );
		$category = lilahcraft_enum( lilahcraft_field( $p, 'category' ), array( 'boosts', 'hunt', 'cosmetics', 'looks', 'perks', 'trophies', 'minis', 'keepers' ) );
		$cost     = lilahcraft_whole( lilahcraft_field( $p, 'cost' ), 0, 1000000000 );
		if ( '' === $id || '' === $category || null === $cost || isset( $prizes[ $id ] ) || count( $prizes ) >= 200 ) {
			continue;
		}
		$name          = lilahcraft_arcade_text( lilahcraft_field( $p, 'name' ), 60 );
		$about         = lilahcraft_arcade_text( lilahcraft_field( $p, 'description' ), 200 );
		$prizes[ $id ] = array(
			'id'       => $id,
			'name'     => '' !== $name ? $name : lilahcraft_id_words( $id ),
			'category' => $category,
			'cost'     => $cost,
		);
		if ( '' !== $about ) {
			$prizes[ $id ]['description'] = $about;
		}
	}
	if ( $prizes ) {
		$out['prizes'] = array_values( $prizes );
	}

	$packs = array();
	foreach ( lilahcraft_list( lilahcraft_field( $j, 'packs' ) ) as $p ) {
		$id   = lilahcraft_id( lilahcraft_field( $p, 'id' ) );
		$cost = lilahcraft_whole( lilahcraft_field( $p, 'cost' ), 0, 1000000000 );
		$odds = lilahcraft_clean_pack_odds( lilahcraft_field( $p, 'odds' ) );
		if ( '' === $id || null === $cost || ! $odds || isset( $packs[ $id ] ) || count( $packs ) >= 50 ) {
			continue;
		}
		$name         = lilahcraft_arcade_text( lilahcraft_field( $p, 'name' ), 60 );
		$packs[ $id ] = array(
			'id'   => $id,
			'name' => '' !== $name ? $name : lilahcraft_id_words( $id ),
			'cost' => $cost,
			'odds' => $odds,
		);
	}
	if ( $packs ) {
		$out['packs'] = array_values( $packs );
	}

	$done = array();
	foreach ( lilahcraft_list( lilahcraft_field( $j, 'achievements' ) ) as $a ) {
		$id     = lilahcraft_id( lilahcraft_field( $a, 'id' ) );
		$about  = lilahcraft_arcade_text( lilahcraft_field( $a, 'description' ), 200 );
		$name   = lilahcraft_arcade_text( lilahcraft_field( $a, 'name' ), 120 );
		$name   = '' !== $name ? $name : lilahcraft_arcade_text( $about, 120 );
		$tokens = lilahcraft_whole( lilahcraft_field( $a, 'tokens' ), 0, 1000000 );
		// HomeCraftMgmt already leaves out the ones won by a game of chance (the jackpot); so does the site.
		if ( '' === $id || '' === $name || null === $tokens || isset( $done[ $id ] ) || count( $done ) >= 200
			|| false !== stripos( $id . ' ' . $name . ' ' . $about, 'jackpot' ) ) {
			continue;
		}
		$done[ $id ] = array(
			'id'          => $id,
			'name'        => $name,
			'description' => '' !== $about ? $about : $name,
			'tokens'      => $tokens,
		);
	}
	if ( $done ) {
		$out['achievements'] = array_values( $done );
	}

	// HomeCraftMgmt 0.38.8, after everything older.
	$rules = lilahcraft_clean_arcade_rules( lilahcraft_field( $j, 'rules' ), $games );
	if ( $rules ) {
		$out['rules'] = $rules;
	}
	if ( true === lilahcraft_field( lilahcraft_field( $j, 'clubhouse' ), 'open' ) ) {
		$out['clubhouse'] = array( 'open' => true );
	}
	$holidays = lilahcraft_clean_arcade_holidays( lilahcraft_field( $j, 'holidays' ), $now );
	if ( $holidays ) {
		$out['holidays'] = $holidays;
	}
	return $out;
}

/**
 * The reward rules (HomeCraftMgmt 0.38.8): the token amounts and caps the games pay by, so the site can print the
 * server's own numbers. Rebuilt from these keys, in this order. A number is a whole number of tokens from 1 to
 * 100,000, sent as a number: the feed leaves out what is switched off, so 0 is never a rule here either, and a
 * part with nothing left in it is left out. [] when nothing is left (or the feed has no rules: 0.38.7).
 *
 *   skillDailyCap     the most every skill game together pays a player a day
 *   chanceDailyLimit  the most a player can put into every game of chance together a day
 *   featuredBonus     tokens for the first finish of today's pick
 *   cabinets          { <id>: { milestone?, daily?, dailyCap? } }: per cabinet, tokens for each medal (once ever),
 *                     for the daily challenge, and the most that cabinet pays a player a day. Only for an id that
 *                     is a cabinet in games
 *   trials            { firstFinish?: { easy?, medium?, hard?, extreme? }, dailyCap? }: a hand-built course's
 *                     first finish by tier, and the most the time trials pay a player a day
 *   golf              { firstFinish?, parOrBetter?, holeInOne?, dailyCap? }
 *   cup               { entry }: tokens to enter one course's Weekly Cup
 *   freshSet          { everyDays, at, zone }: a new set of Fresh Courses every so many days (1 to 366), at
 *                     "Mon 04:00" (a weekday and a 24-hour time; the time alone, "04:00", when the sets don't
 *                     change on one weekday), in the time zone named ("America/Chicago": a region name of letters,
 *                     digits, _ + - and up to two slashes, at most 40 characters). All three or none
 *   restarts          [ "04:00", "16:00" ]: the daily restarts as 24-hour times in that zone, each once, sorted,
 *                     24 at most
 *
 * @param mixed $given The feed's rules.
 * @param array $games The cleaned games, by id.
 * @return array
 */
function lilahcraft_clean_arcade_rules( $given, $games ) {
	$tokens = function ( $part, $keys ) {
		$kept = array();
		foreach ( $keys as $key ) {
			$n = lilahcraft_whole( lilahcraft_json_number( lilahcraft_field( $part, $key ) ), 1, 100000 );
			if ( null !== $n ) {
				$kept[ $key ] = $n;
			}
		}
		return $kept;
	};
	$given = lilahcraft_object( $given );
	$out   = $tokens( $given, array( 'skillDailyCap', 'chanceDailyLimit', 'featuredBonus' ) );

	$cabinets = array();
	foreach ( lilahcraft_object( lilahcraft_field( $given, 'cabinets' ) ) as $id => $part ) {
		$id   = lilahcraft_id( $id );
		$part = $tokens( $part, array( 'milestone', 'daily', 'dailyCap' ) );
		if ( $part && isset( $games[ $id ] ) && 'cabinet' === $games[ $id ]['kind'] && ! isset( $cabinets[ $id ] ) ) {
			$cabinets[ $id ] = $part;
		}
	}
	if ( $cabinets ) {
		$out['cabinets'] = $cabinets;
	}

	$part   = lilahcraft_field( $given, 'trials' );
	$first  = $tokens( lilahcraft_field( $part, 'firstFinish' ), array( 'easy', 'medium', 'hard', 'extreme' ) );
	$trials = ( $first ? array( 'firstFinish' => $first ) : array() ) + $tokens( $part, array( 'dailyCap' ) );
	if ( $trials ) {
		$out['trials'] = $trials;
	}
	$golf = $tokens( lilahcraft_field( $given, 'golf' ), array( 'firstFinish', 'parOrBetter', 'holeInOne', 'dailyCap' ) );
	if ( $golf ) {
		$out['golf'] = $golf;
	}
	$cup = $tokens( lilahcraft_field( $given, 'cup' ), array( 'entry' ) );
	if ( $cup ) {
		$out['cup'] = $cup;
	}

	$clock = '(?:[01][0-9]|2[0-3]):[0-5][0-9]';
	$part  = lilahcraft_field( $given, 'freshSet' );
	$days  = lilahcraft_whole( lilahcraft_json_number( lilahcraft_field( $part, 'everyDays' ) ), 1, 366 );
	$at    = lilahcraft_field( $part, 'at' );
	$zone  = lilahcraft_field( $part, 'zone' );
	if ( null !== $days && is_string( $at ) && preg_match( '/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) )?' . $clock . '$/D', $at )
		&& is_string( $zone ) && strlen( $zone ) <= 40 && preg_match( '#^[A-Za-z][A-Za-z0-9_+\-]*(?:/[A-Za-z0-9_+\-]+){0,2}$#D', $zone ) ) {
		$out['freshSet'] = array(
			'everyDays' => $days,
			'at'        => $at,
			'zone'      => $zone,
		);
	}

	$restarts = array();
	foreach ( lilahcraft_list( lilahcraft_field( $given, 'restarts' ) ) as $time ) {
		if ( is_string( $time ) && preg_match( '/^' . $clock . '$/D', $time ) && ! in_array( $time, $restarts, true ) && count( $restarts ) < 24 ) {
			$restarts[] = $time;
		}
	}
	if ( $restarts ) {
		sort( $restarts, SORT_STRING );
		$out['restarts'] = $restarts;
	}
	return $out;
}

/**
 * The holidays on the server's calendar (HomeCraftMgmt 0.38.8 sends the ones running today or starting within 14
 * days): [ { id, name, from, to } ], soonest first, 12 at most. id is the holiday and the year it starts in
 * ("thanksgiving_2026"); from and to are the first millisecond of its first day and the last of its last (ms; the
 * days are the server's, so they are formatted in the server's time zone). Names and dates only.
 *
 * A row is left out when its id or name isn't text, when from or to isn't a time sent as a number (from 2020 on;
 * a from more than a year ahead, or a to more than a year after its from, is a clock or unit slip), when its to is
 * before its from, or when its id came before.
 *
 * @param mixed $list The feed's holidays.
 * @param int   $now  The time now (ms).
 * @return array
 */
function lilahcraft_clean_arcade_holidays( $list, $now ) {
	$year = 366 * DAY_IN_SECONDS * 1000;
	$rows = array();
	foreach ( lilahcraft_list( $list ) as $h ) {
		$id   = lilahcraft_field( $h, 'id' );
		$id   = is_string( $id ) ? lilahcraft_id( $id ) : '';
		$name = lilahcraft_field( $h, 'name' );
		$name = is_string( $name ) ? lilahcraft_arcade_text( $name, 60 ) : '';
		$from = lilahcraft_time( lilahcraft_json_number( lilahcraft_field( $h, 'from' ) ), $now + $year, LILAHCRAFT_EARLIEST_DATE );
		$to   = lilahcraft_time( lilahcraft_json_number( lilahcraft_field( $h, 'to' ) ), $from + $year, LILAHCRAFT_EARLIEST_DATE );
		if ( '' === $id || '' === $name || $from <= 0 || $to < $from || isset( $rows[ $id ] ) || count( $rows ) >= 12 ) {
			continue;
		}
		$rows[ $id ] = array(
			'id'   => $id,
			'name' => $name,
			'from' => $from,
			'to'   => $to,
		);
	}
	// Soonest first; holidays that start together stay in the feed's order (usort() only keeps that from PHP 8).
	$rows  = array_values( $rows );
	$order = array_keys( $rows );
	usort(
		$order,
		function ( $a, $b ) use ( $rows ) {
			return array( $rows[ $a ]['from'], $a ) <=> array( $rows[ $b ]['from'], $b );
		}
	);
	$out = array();
	foreach ( $order as $i ) {
		$out[] = $rows[ $i ];
	}
	return $out;
}

/**
 * One games[] entry, or null when it isn't one the site can show. Every entry has { id, name, kind }; then by kind:
 *
 *   chance    stakes [tokens in], rtp (the lowest of rtpByStake), rtpByStake { stake: percent, one decimal rounded
 *             down, above 0 and below 100 }, dailyLimit?, paytable? (lilahcraft_clean_pay_row()), rules?, and only
 *             these extras: payouts? { stake: { win, twentyOne, doubleWin? } } (Twenty-One; a stake that offers no
 *             Double has no doubleWin), maxMultiplier? and maxGuesses? (Higher or Lower). A stake without its
 *             give-back is left out, and so is a game with no stake left. A give-back of 100 or more is never a
 *             number on the site: HomeCraftMgmt closes the Scratch Ticket when its prizes add up to that much and
 *             says "closed": true, and then the entry is { id, name, kind, closed: true } and nothing else.
 *   cabinet   board, unit: ms|points|flips|apples|wins, lowerIsBetter, best?, holder?, top? (an unknown unit leaves
 *             out unit, lowerIsBetter, best, holder and top: a score can't be shown without its unit)
 *   parkour, elytra, boat, dropper   tier?: easy|medium|hard|extreme, record? { ms, at?, holder? }, daily?, fresh?,
 *             classic? (lilahcraft_clean_arcade_fresh()), cup? { entry, pool, entrants, endsAt }: this week's Weekly
 *             Cup on the course (all four or none), top?
 *   golf      holes?, par?, record? { strokes, at?, holder? }, daily?, fresh?, classic?, top?
 *   arena     shape?: disc|square|ring|plus|diamond, top? (Falling Floors: this week's longest solo times, where a
 *             higher time is the better one)
 *
 * top is the board's leaderboard, lilahcraft_clean_arcade_top(). A Fresh course's record and top are its
 * current set's. holder only comes through when the feed sends one (HomeCraftMgmt does only while its owner has
 * names on).
 *
 * @param mixed $g   Feed entry.
 * @param int   $now The time now (ms).
 * @return array|null
 */
function lilahcraft_clean_arcade_game( $g, $now ) {
	$id   = lilahcraft_id( lilahcraft_field( $g, 'id' ) );
	$kind = lilahcraft_enum( lilahcraft_field( $g, 'kind' ), array( 'chance', 'cabinet', 'parkour', 'elytra', 'boat', 'dropper', 'golf', 'arena' ) );
	if ( '' === $id || '' === $kind ) {
		return null;
	}
	$name = lilahcraft_arcade_text( lilahcraft_field( $g, 'name' ), 60 );
	$row  = array(
		'id'   => $id,
		'name' => '' !== $name ? $name : lilahcraft_id_words( $id ),
		'kind' => $kind,
	);

	if ( 'chance' === $kind ) {
		if ( true === lilahcraft_field( $g, 'closed' ) ) {
			$row['closed'] = true;
			return $row;
		}
		$given = lilahcraft_object( lilahcraft_field( $g, 'rtpByStake' ) );
		$rtps  = array();
		foreach ( lilahcraft_list( lilahcraft_field( $g, 'stakes' ) ) as $stake ) {
			$stake = lilahcraft_whole( $stake, 1, 100000 );
			$rtp   = null === $stake ? null : lilahcraft_num( isset( $given[ $stake ] ) ? $given[ $stake ] : null );
			if ( null !== $rtp && $rtp > 0 && $rtp < 100 && ! isset( $rtps[ $stake ] ) && count( $rtps ) < 20 ) {
				// One decimal, rounded down like the feed's, so "about N" can never read high.
				$rtps[ $stake ] = floor( round( $rtp * 10, 6 ) ) / 10;
			}
		}
		if ( ! $rtps ) {
			return null;
		}
		$row['stakes']     = array_keys( $rtps );
		$row['rtp']        = min( $rtps );
		$row['rtpByStake'] = $rtps;
		$limit             = lilahcraft_whole( lilahcraft_field( $g, 'dailyLimit' ), 1, 100000 );
		if ( null !== $limit ) {
			$row['dailyLimit'] = $limit;
		}
		$rows = array();
		foreach ( lilahcraft_list( lilahcraft_field( $g, 'paytable' ) ) as $p ) {
			$p = lilahcraft_clean_pay_row( $p, $rtps );
			if ( $p && count( $rows ) < 100 ) {
				$rows[] = $p;
			}
		}
		if ( $rows ) {
			$row['paytable'] = $rows;
		}
		$rules = lilahcraft_arcade_text( lilahcraft_field( $g, 'rules' ), 200 );
		if ( '' !== $rules ) {
			$row['rules'] = $rules;
		}
		$given   = lilahcraft_object( lilahcraft_field( $g, 'payouts' ) );
		$payouts = array();
		foreach ( array_keys( $rtps ) as $stake ) {
			$p   = isset( $given[ $stake ] ) ? $given[ $stake ] : null;
			$two = array(
				'win'       => lilahcraft_whole( lilahcraft_field( $p, 'win' ), 0, 10000000 ),
				'twentyOne' => lilahcraft_whole( lilahcraft_field( $p, 'twentyOne' ), 0, 10000000 ),
			);
			if ( in_array( null, $two, true ) ) {
				continue;
			}
			$double = lilahcraft_whole( lilahcraft_field( $p, 'doubleWin' ), 0, 10000000 );
			if ( null !== $double ) {
				$two['doubleWin'] = $double;
			}
			$payouts[ $stake ] = $two;
		}
		if ( $payouts ) {
			$row['payouts'] = $payouts;
		}
		$top = lilahcraft_num( lilahcraft_field( $g, 'maxMultiplier' ) );
		if ( null !== $top && $top > 0 && $top <= 1000000 ) {
			$row['maxMultiplier'] = floor( $top ) === $top ? (int) $top : $top;
		}
		$guesses = lilahcraft_whole( lilahcraft_field( $g, 'maxGuesses' ), 1, 1000 );
		if ( null !== $guesses ) {
			$row['maxGuesses'] = $guesses;
		}
		return $row;
	}

	if ( 'cabinet' === $kind ) {
		$row['board'] = lilahcraft_arcade_text( lilahcraft_field( $g, 'board' ), 40 );
		$unit         = lilahcraft_enum( lilahcraft_field( $g, 'unit' ), array( 'ms', 'points', 'flips', 'apples', 'wins' ) );
		if ( '' !== $unit ) {
			$lower                = lilahcraft_field( $g, 'lowerIsBetter' );
			$row['unit']          = $unit;
			$row['lowerIsBetter'] = is_bool( $lower ) ? $lower : in_array( $unit, array( 'ms', 'flips' ), true );
			$best                 = lilahcraft_whole( lilahcraft_field( $g, 'best' ), 0, 1000000000000 );
			if ( null !== $best ) {
				$row['best'] = $best;
				$holder      = lilahcraft_arcade_holder( lilahcraft_field( $g, 'holder' ) );
				if ( '' !== $holder ) {
					$row['holder'] = $holder;
				}
			}
			$top = lilahcraft_clean_arcade_top( lilahcraft_field( $g, 'top' ), $unit, $now );
			if ( $top ) {
				$row['top'] = $top;
			}
		}
		return $row;
	}

	if ( 'arena' === $kind ) {
		$shape = lilahcraft_enum( lilahcraft_field( $g, 'shape' ), array( 'disc', 'square', 'ring', 'plus', 'diamond' ) );
		if ( '' !== $shape ) {
			$row['shape'] = $shape;
		}
		$top = lilahcraft_clean_arcade_top( lilahcraft_field( $g, 'top' ), 'ms', $now );
		if ( $top ) {
			$row['top'] = $top;
		}
		return $row;
	}

	$given = lilahcraft_object( lilahcraft_field( $g, 'record' ) );
	if ( 'golf' === $kind ) {
		foreach ( array( 'holes' => 100, 'par' => 1000 ) as $key => $max ) {
			$n = lilahcraft_whole( lilahcraft_field( $g, $key ), 1, $max );
			if ( null !== $n ) {
				$row[ $key ] = $n;
			}
		}
		$key   = 'strokes';
		$score = lilahcraft_whole( lilahcraft_field( $given, $key ), 1, 100000 );
	} else {
		$tier = lilahcraft_enum( lilahcraft_field( $g, 'tier' ), array( 'easy', 'medium', 'hard', 'extreme' ) );
		if ( '' !== $tier ) {
			$row['tier'] = $tier;
		}
		$key   = 'ms';
		$score = lilahcraft_whole( lilahcraft_field( $given, $key ), 1, 1000000000 );
	}
	if ( null !== $score ) {
		$record = array( $key => $score );
		// A record set "tomorrow" is a clock slip: it keeps its score and loses the date.
		$at = lilahcraft_time( lilahcraft_field( $given, 'at' ), $now + DAY_IN_SECONDS * 1000 );
		if ( $at > 0 ) {
			$record['at'] = $at;
		}
		$holder = lilahcraft_arcade_holder( lilahcraft_field( $given, 'holder' ) );
		if ( '' !== $holder ) {
			$record['holder'] = $holder;
		}
		$row['record'] = $record;
	}
	$row += lilahcraft_clean_arcade_fresh( $g, $kind, $now );
	if ( 'golf' !== $kind ) {
		// Golf never runs a Cup. A Cup without its entry price or its end isn't one.
		$given = lilahcraft_field( $g, 'cup' );
		$cup   = array(
			'entry'    => lilahcraft_whole( lilahcraft_field( $given, 'entry' ), 1, 100000 ),
			'pool'     => lilahcraft_whole( lilahcraft_field( $given, 'pool' ), 0, 1000000000 ),
			'entrants' => lilahcraft_whole( lilahcraft_field( $given, 'entrants' ), 0, 100000 ),
			'endsAt'   => lilahcraft_time( lilahcraft_field( $given, 'endsAt' ), $now + 60 * DAY_IN_SECONDS * 1000 ),
		);
		if ( ! in_array( null, $cup, true ) && $cup['endsAt'] > 0 ) {
			$row['cup'] = $cup;
		}
	}
	$top = lilahcraft_clean_arcade_top( lilahcraft_field( $g, 'top' ), $key, $now );
	if ( $top ) {
		$row['top'] = $top;
	}
	return $row;
}

/**
 * The parts only a Fresh Courses entry has (the courses the server builds itself, a new set each week), each
 * only when the feed has a good one:
 *
 *   daily    { day, nextAt?, goldMs?, silverMs?, cadence?, lastDay? }: the set's first day ("2026-11-09"), when the
 *            next set is due (ms; a recalled Classic has none), the times for three stars and two stars (never on
 *            golf; left out together when gold is the slower one), the set's length in days (7 weekly, 1 daily)
 *            and its last day
 *   fresh    { code, from?, to?, cadenceDays?, track? }: the course code ("HARD-40"), when this course went up and
 *            when it changes (ms). track (HomeCraftMgmt 0.38.8) is only on a boat course, the Ice Boat: which of
 *            its two tracks this set is, exactly "Winding Road" or "Slalom". The feed's short seed isn't shown
 *            anywhere, so it isn't passed on
 *   classic  { code, from?, to? }: a Classics slot: the recalled course's code and the recall's window (no to: for good)
 *
 * A time more than a year ahead is a clock or unit slip and counts as missing.
 *
 * @param mixed  $g    Feed entry.
 * @param string $kind Its kind: parkour, elytra, boat, dropper or golf.
 * @param int    $now  The time now (ms).
 * @return array
 */
function lilahcraft_clean_arcade_fresh( $g, $kind, $now ) {
	$golf  = 'golf' === $kind;
	$out   = array();
	$year  = $now + 366 * DAY_IN_SECONDS * 1000;
	$given = lilahcraft_field( $g, 'daily' );
	$day   = lilahcraft_arcade_day( lilahcraft_field( $given, 'day' ) );
	if ( '' !== $day ) {
		$daily = array( 'day' => $day );
		$next  = lilahcraft_time( lilahcraft_field( $given, 'nextAt' ), $year );
		if ( $next > 0 ) {
			$daily['nextAt'] = $next;
		}
		$gold   = $golf ? null : lilahcraft_whole( lilahcraft_field( $given, 'goldMs' ), 1, 1000000000 );
		$silver = $golf ? null : lilahcraft_whole( lilahcraft_field( $given, 'silverMs' ), 1, 1000000000 );
		if ( null === $gold || null === $silver || $gold <= $silver ) {
			$daily += array_filter(
				array(
					'goldMs'   => $gold,
					'silverMs' => $silver,
				)
			);
		}
		$cadence = lilahcraft_whole( lilahcraft_field( $given, 'cadence' ), 1, 366 );
		if ( null !== $cadence ) {
			$daily['cadence'] = $cadence;
		}
		$last = lilahcraft_arcade_day( lilahcraft_field( $given, 'lastDay' ) );
		if ( '' !== $last && $last >= $day ) {
			$daily['lastDay'] = $last;
		}
		$out['daily'] = $daily;
	}
	foreach ( array( 'fresh', 'classic' ) as $part ) {
		$given = lilahcraft_field( $g, $part );
		$code  = lilahcraft_arcade_code( lilahcraft_field( $given, 'code' ) );
		if ( '' === $code ) {
			continue;
		}
		$out[ $part ] = array( 'code' => $code );
		$from         = lilahcraft_time( lilahcraft_field( $given, 'from' ), $year );
		$to           = lilahcraft_time( lilahcraft_field( $given, 'to' ), $year );
		if ( $from > 0 ) {
			$out[ $part ]['from'] = $from;
		}
		if ( $to > $from ) {
			$out[ $part ]['to'] = $to;
		}
		$days = 'fresh' === $part ? lilahcraft_whole( lilahcraft_field( $given, 'cadenceDays' ), 1, 366 ) : null;
		if ( null !== $days ) {
			$out[ $part ]['cadenceDays'] = $days;
		}
		$track = ( 'fresh' === $part && 'boat' === $kind ) ? lilahcraft_field( $given, 'track' ) : null;
		if ( in_array( $track, array( 'Winding Road', 'Slalom' ), true ) ) {
			$out[ $part ]['track'] = $track;
		}
	}
	return $out;
}

/**
 * A board's leaderboard: its best rows in the feed's order (best first, ties sharing a rank: 1, 1, 3), at most 25:
 * [ { rank, value, unit, at?, holder? } ]. Every row is in the board's own unit: ms for a course and for Falling
 * Floors, strokes for golf, the cabinet's unit for a cabinet. A row in another unit, without a whole rank or value,
 * or ranked better than the row before it is left out. at more than a day ahead is dropped (the row keeps its score).
 *
 * @param mixed  $list The feed's top.
 * @param string $unit The board's unit.
 * @param int    $now  The time now (ms).
 * @return array
 */
function lilahcraft_clean_arcade_top( $list, $unit, $now ) {
	// A time or a round of golf is at least 1; a cabinet's score can be 0.
	$min  = in_array( $unit, array( 'ms', 'strokes' ), true ) ? 1 : 0;
	$max  = 'ms' === $unit ? 1000000000 : ( 'strokes' === $unit ? 100000 : 1000000000000 );
	$rows = array();
	$last = 1;
	foreach ( lilahcraft_list( $list ) as $r ) {
		$rank  = lilahcraft_whole( lilahcraft_field( $r, 'rank' ), $last, 100 );
		$value = lilahcraft_whole( lilahcraft_field( $r, 'value' ), $min, $max );
		if ( null === $rank || null === $value || '' === lilahcraft_enum( lilahcraft_field( $r, 'unit' ), array( $unit ) ) || count( $rows ) >= 25 ) {
			continue;
		}
		$last = $rank;
		$row  = array(
			'rank'  => $rank,
			'value' => $value,
			'unit'  => $unit,
		);
		$at   = lilahcraft_time( lilahcraft_field( $r, 'at' ), $now + DAY_IN_SECONDS * 1000 );
		if ( $at > 0 ) {
			$row['at'] = $at;
		}
		$holder = lilahcraft_arcade_holder( lilahcraft_field( $r, 'holder' ) );
		if ( '' !== $holder ) {
			$row['holder'] = $holder;
		}
		$rows[] = $row;
	}
	return $rows;
}

/**
 * One paytable row, or null when it can't be shown. Every row keeps its odds, so a payout is never shown without
 * them: { stake?, combo, pays, chance, oneIn } or { stake?, combo, pays, spaces, of } (the Wheel's 24 spaces).
 *
 *   stake   a row with one pays that many tokens at that stake (one of the game's stakes); a row without one
 *           pays that multiple of the tokens put in
 *   chance  above 0 and at most 1, with oneIn: the "1 in N" the game screen shows, which must agree with chance
 *   spaces  of `of` spaces (0 < spaces ≤ of ≤ 1000)
 *
 * @param mixed $p      Feed row.
 * @param array $stakes The game's cleaned stakes, as keys.
 * @return array|null
 */
function lilahcraft_clean_pay_row( $p, $stakes ) {
	$out = array();
	if ( null !== lilahcraft_field( $p, 'stake' ) ) {
		$stake = lilahcraft_whole( $p['stake'], 1, 100000 );
		if ( null === $stake || ! isset( $stakes[ $stake ] ) ) {
			return null;
		}
		$out['stake'] = $stake;
	}
	$combo  = lilahcraft_arcade_text( lilahcraft_field( $p, 'combo' ), 60 );
	$pays   = lilahcraft_whole( lilahcraft_field( $p, 'pays' ), 0, 10000000 );
	$chance = lilahcraft_num( lilahcraft_field( $p, 'chance' ) );
	$one_in = lilahcraft_whole( lilahcraft_field( $p, 'oneIn' ), 1, 1000000000 );
	$spaces = lilahcraft_whole( lilahcraft_field( $p, 'spaces' ), 1, 1000 );
	$of     = lilahcraft_whole( lilahcraft_field( $p, 'of' ), 1, 1000 );
	// oneIn is rounded from the exact chance and chance to 4 significant digits, so they agree to within 1 %.
	$odds = null !== $chance && $chance > 0 && $chance <= 1 && null !== $one_in && abs( $one_in - 1 / $chance ) <= max( 1, 0.01 / $chance );
	$ring = null !== $spaces && null !== $of && $spaces <= $of;
	if ( '' === $combo || null === $pays || ( ! $odds && ! $ring ) ) {
		return null;
	}
	$out['combo'] = $combo;
	$out['pays']  = $pays;
	if ( $odds ) {
		$out['chance'] = $chance;
		$out['oneIn']  = $one_in;
	}
	if ( $ring ) {
		$out['spaces'] = $spaces;
		$out['of']     = $of;
	}
	return $out;
}

/**
 * A Card Pack's odds in rarity order, { COMMON: 62, UNCOMMON: 28, … }: percents above 0, each rarity once (any case
 * in the feed, upper case out). [] when there are none, or when they don't add up to 100 (±1).
 *
 * @param mixed $odds Feed value.
 * @return array
 */
function lilahcraft_clean_pack_odds( $odds ) {
	$given = array();
	foreach ( lilahcraft_object( $odds ) as $key => $pct ) {
		$key = strtoupper( (string) $key );
		if ( ! isset( $given[ $key ] ) ) {
			$given[ $key ] = $pct;
		}
	}
	$out = array();
	foreach ( array( 'COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY' ) as $rarity ) {
		$pct = lilahcraft_num( isset( $given[ $rarity ] ) ? $given[ $rarity ] : null );
		if ( null !== $pct && $pct > 0 && $pct <= 100 ) {
			$out[ $rarity ] = floor( $pct ) === $pct ? (int) $pct : $pct;
		}
	}
	return ( $out && abs( array_sum( $out ) - 100 ) <= 1 ) ? $out : array();
}
