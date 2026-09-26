<?php
/**
 * Same-origin REST routes for the live data.
 *
 *   GET /wp-json/lilahcraft/v1/market   the Market feed (HomeCraftMgmt /api/market)
 *   GET /wp-json/lilahcraft/v1/minis    the Minis feed  (HomeCraftMgmt /api/minis)
 *   GET /wp-json/lilahcraft/v1/status   { online, players, max, version }
 *
 * WordPress fetches each feed, keeps it in a transient for the configured seconds and keeps the
 * last good copy in an option. A failed fetch serves that copy with "stale": true. With no URL set,
 * or nothing good yet, the answer is { "sample": true } and the page shows labelled sample data.
 * Only whitelisted fields are passed on.
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
						return lilahcraft_rest_response( $data, $request );
					},
				)
			);
		}
	}
);

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
		lilahcraft_note_feed( $feed, true, '' );
		set_transient( 'lilahcraft_feed_' . $feed, $fresh, $ttl );
		return $fresh;
	}

	lilahcraft_note_feed( $feed, false, $fresh->get_error_message() );
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
 */
function lilahcraft_note_feed( $feed, $ok, $error ) {
	update_option(
		'lilahcraft_feedstat_' . $feed,
		array(
			'time'  => time(),
			'ok'    => (bool) $ok,
			'error' => substr( sanitize_text_field( $error ), 0, 200 ),
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
	$res = wp_remote_get(
		$url,
		array(
			'timeout'     => 5,
			'redirection' => 2,
			'headers'     => array( 'Accept' => 'application/json' ),
			'user-agent'  => 'LilahCraft site/' . wp_get_theme( get_template() )->get( 'Version' ),
		)
	);
	if ( is_wp_error( $res ) ) {
		return $res;
	}
	$code = (int) wp_remote_retrieve_response_code( $res );
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
 * Keep only the Market fields the site uses.
 *
 * @param array $j Decoded feed.
 * @return array|WP_Error
 */
function lilahcraft_clean_market( $j ) {
	if ( ! isset( $j['items'] ) || ! is_array( $j['items'] ) ) {
		return new WP_Error( 'lilahcraft_feed', __( 'The market feed has no items list.', 'lilahcraft' ) );
	}
	$items = array();
	foreach ( $j['items'] as $it ) {
		if ( ! is_array( $it ) || ! isset( $it['id'] ) ) {
			continue;
		}
		$price = lilahcraft_num( isset( $it['price'] ) ? $it['price'] : null );
		if ( null === $price ) {
			continue;
		}
		$history = array();
		if ( isset( $it['history'] ) && is_array( $it['history'] ) ) {
			foreach ( array_slice( $it['history'], -96 ) as $h ) {
				if ( ! is_array( $h ) || null === lilahcraft_num( isset( $h['p'] ) ? $h['p'] : null ) ) {
					continue;
				}
				$history[] = array(
					't' => isset( $h['t'] ) ? (int) $h['t'] : 0,
					'p' => (float) $h['p'],
					's' => isset( $h['s'] ) ? (int) $h['s'] : 0,
				);
			}
		}
		$name    = lilahcraft_text( isset( $it['name'] ) ? $it['name'] : '' );
		$items[] = array(
			'id'        => substr( preg_replace( '/[^a-z0-9_:\-]/', '', strtolower( (string) $it['id'] ) ), 0, 80 ),
			'name'      => '' !== $name ? $name : ucwords( str_replace( '_', ' ', strtolower( (string) $it['id'] ) ) ),
			'material'  => substr( preg_replace( '/[^A-Z0-9_]/', '', strtoupper( (string) ( isset( $it['material'] ) ? $it['material'] : $it['id'] ) ) ), 0, 80 ),
			'price'     => $price,
			'buy'       => lilahcraft_num( isset( $it['buy'] ) ? $it['buy'] : null ),
			'sell'      => lilahcraft_num( isset( $it['sell'] ) ? $it['sell'] : null ),
			'stock'     => isset( $it['stock'] ) && is_numeric( $it['stock'] ) ? max( 0, (int) $it['stock'] ) : null,
			'maxStock'  => isset( $it['maxStock'] ) && is_numeric( $it['maxStock'] ) ? max( 0, (int) $it['maxStock'] ) : null,
			'change24h' => lilahcraft_num( isset( $it['change24h'] ) ? $it['change24h'] : null ),
			'history'   => $history,
		);
	}
	$refresh = isset( $j['refreshSeconds'] ) ? (int) $j['refreshSeconds'] : 30;
	return array(
		'title'          => lilahcraft_text( isset( $j['title'] ) ? $j['title'] : '' ),
		'generatedAt'    => isset( $j['generatedAt'] ) ? (int) $j['generatedAt'] : 0,
		'refreshSeconds' => max( 5, min( 3600, $refresh ? $refresh : 30 ) ),
		'items'          => $items,
	);
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
		if ( ! is_array( $m ) || ! isset( $m['id'] ) ) {
			continue;
		}
		$cap     = isset( $m['cap'] ) && is_numeric( $m['cap'] ) ? (int) $m['cap'] : -1;
		$printed = isset( $m['printed'] ) && is_numeric( $m['printed'] ) ? max( 0, (int) $m['printed'] ) : 0;
		$row     = array(
			'id'       => substr( preg_replace( '/[^a-z0-9_:\-]/', '', strtolower( (string) $m['id'] ) ), 0, 80 ),
			'name'     => lilahcraft_text( isset( $m['name'] ) ? $m['name'] : $m['id'] ),
			'rarity'   => substr( preg_replace( '/[^A-Z_]/', '', strtoupper( (string) ( isset( $m['rarity'] ) ? $m['rarity'] : 'COMMON' ) ) ), 0, 20 ),
			'category' => substr( preg_replace( '/[^A-Z_]/', '', strtoupper( (string) ( isset( $m['category'] ) ? $m['category'] : 'MISC' ) ) ), 0, 30 ),
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
		'generatedAt' => isset( $j['generatedAt'] ) ? (int) $j['generatedAt'] : 0,
		'minis'       => $minis,
	);
}
