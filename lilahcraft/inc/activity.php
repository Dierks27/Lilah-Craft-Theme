<?php
/**
 * "When are people on?": the player count over the day, from the site's own server pings.
 *
 * Every fresh ping (visitors' header checks, plus a 15-minute WP-Cron job so quiet hours are counted
 * too) records the hour's highest player count in site time. Fourteen days are kept, in one option.
 *
 *   GET /wp-json/lilahcraft/v1/activity
 *   { "enough": false }  until the samples of the last fourteen days span at least 3 days (72 hours
 *   from the first to the last) and 36 hours have one, then
 *   { "enough": true, "hours": [ avg players for 0:00 … 23:00, or null ], "busiest": 19,
 *     "days": 6 (the days that span covers, 1 to 14), "timezone": "America/Chicago" }
 *
 * No player names, only counts. Nothing here needs HomeCraftMgmt.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Record one fresh status result: the highest player count seen in this hour (site time).
 *
 * @param array $status Result of lilahcraft_server_status().
 */
function lilahcraft_log_activity( $status ) {
	$log    = get_option( 'lilahcraft_activity', array() );
	$log    = is_array( $log ) ? $log : array();
	$before = count( $log );
	// Keep fourteen days, also while the server is down.
	$oldest = lilahcraft_activity_oldest();
	foreach ( array_keys( $log ) as $k ) {
		if ( strcmp( (string) $k, $oldest ) < 0 ) {
			unset( $log[ $k ] );
		}
	}
	if ( ! empty( $status['online'] ) && isset( $status['players'] ) ) {
		$key = wp_date( 'Y-m-d H' );
		$now = (int) $status['players'];
		if ( ! isset( $log[ $key ] ) || $now > (int) $log[ $key ] ) {
			$log[ $key ] = $now;
		}
	} elseif ( count( $log ) === $before ) {
		return; // Offline or unknown: no guessing, and nothing old to drop.
	}
	update_option( 'lilahcraft_activity', $log, false );
}
add_action( 'lilahcraft_status_fresh', 'lilahcraft_log_activity' );

/**
 * The oldest hour kept, as a log key: fourteen days ago, site time.
 *
 * @return string
 */
function lilahcraft_activity_oldest() {
	return wp_date( 'Y-m-d H', time() - 14 * DAY_IN_SECONDS );
}

/**
 * The average day: players per hour of the day, averaged over the days that have a sample for it.
 * Only the last fourteen days count, so a log that stopped (the ping failing for weeks) runs out
 * instead of being served as recent.
 *
 * @return array
 */
function lilahcraft_activity() {
	$log    = get_option( 'lilahcraft_activity', array() );
	$log    = is_array( $log ) ? $log : array();
	$oldest = lilahcraft_activity_oldest();
	$sum    = array_fill( 0, 24, 0 );
	$n      = array_fill( 0, 24, 0 );
	$keys   = array();
	foreach ( $log as $k => $players ) {
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} (\d{2})$/', (string) $k, $m ) || strcmp( (string) $k, $oldest ) < 0 ) {
			continue;
		}
		$h          = (int) $m[1];
		$sum[ $h ] += (int) $players;
		++$n[ $h ];
		$keys[] = (string) $k;
	}
	// The hours from the first sample to the last, both counted: 48 hourly samples span 48, not "3 days".
	$span = $keys ? ( strtotime( max( $keys ) . ':00' ) - strtotime( min( $keys ) . ':00' ) ) / HOUR_IN_SECONDS + 1 : 0;
	if ( $span < 72 || array_sum( $n ) < 36 ) {
		return array( 'enough' => false );
	}
	$hours   = array();
	$busiest = null;
	for ( $h = 0; $h < 24; $h++ ) {
		$hours[ $h ] = $n[ $h ] ? round( $sum[ $h ] / $n[ $h ], 1 ) : null;
		if ( null !== $hours[ $h ] && ( null === $busiest || $hours[ $h ] > $hours[ $busiest ] ) ) {
			$busiest = $h;
		}
	}
	return array(
		'enough'   => true,
		'hours'    => $hours,
		'busiest'  => ( null !== $busiest && $hours[ $busiest ] > 0 ) ? $busiest : null,
		'days'     => (int) min( 14, max( 1, round( $span / 24 ) ) ),
		'timezone' => wp_timezone_string(),
	);
}

add_action(
	'rest_api_init',
	function () {
		register_rest_route(
			'lilahcraft/v1',
			'/activity',
			array(
				'methods'             => 'GET',
				'permission_callback' => '__return_true',
				'callback'            => function ( WP_REST_Request $request ) {
					return lilahcraft_rest_response( lilahcraft_activity(), $request );
				},
			)
		);
	}
);

// Ping every 15 minutes so the quiet hours count too (WP-Cron runs when the site gets visits).
add_filter(
	'cron_schedules',
	function ( $schedules ) {
		$schedules['lilahcraft_15min'] = array(
			'interval' => 15 * MINUTE_IN_SECONDS,
			'display'  => __( 'Every 15 minutes (LilahCraft)', 'lilahcraft' ),
		);
		return $schedules;
	}
);
add_action(
	'lilahcraft_activity_ping',
	function () {
		delete_transient( 'lilahcraft_status' );
		lilahcraft_server_status();
	}
);
// Not while the theme is only being previewed: nothing would ever clear the job on that site.
add_action(
	'init',
	function () {
		if ( lilahcraft_is_active_theme() && ! wp_next_scheduled( 'lilahcraft_activity_ping' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'lilahcraft_15min', 'lilahcraft_activity_ping' );
		}
	}
);
// Switching to another theme stops the job.
add_action(
	'switch_theme',
	function () {
		wp_clear_scheduled_hook( 'lilahcraft_activity_ping' );
	}
);
