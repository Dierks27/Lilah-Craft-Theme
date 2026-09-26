<?php
/**
 * Settings > LilahCraft: feed URLs, the server to ping, versions and cache time.
 *
 * Everything lives in one option, lilahcraft_settings. Read it with lilahcraft_setting( 'key' ).
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Default settings.
 *
 * @return array
 */
function lilahcraft_defaults() {
	return array(
		'market_url'    => '',
		'minis_url'     => '',
		'server_host'   => 'mc.lilahcraft.com',
		'server_port'   => 25565,
		'mc_version'    => '',
		'cb_version'    => '0.4.0',
		'cb_url'        => 'https://github.com/Dierks27/CraftBridge-Client/releases/download/v{version}/craftbridge-client-{mc}-{loader}-{version}.jar',
		'cache_seconds' => 60,
	);
}

/**
 * All settings, saved values over defaults.
 *
 * @return array
 */
function lilahcraft_settings() {
	$saved = get_option( 'lilahcraft_settings', array() );
	return wp_parse_args( is_array( $saved ) ? $saved : array(), lilahcraft_defaults() );
}

/**
 * One setting.
 *
 * @param string $key Setting name.
 * @return mixed
 */
function lilahcraft_setting( $key ) {
	$all = lilahcraft_settings();
	return isset( $all[ $key ] ) ? $all[ $key ] : null;
}

/**
 * Clean a feed URL: http or https only, otherwise blank.
 *
 * @param string $url Raw input.
 * @return string
 */
function lilahcraft_clean_url( $url ) {
	$url = esc_url_raw( trim( (string) $url ), array( 'http', 'https' ) );
	return ( $url && filter_var( $url, FILTER_VALIDATE_URL ) ) ? $url : '';
}

/**
 * Sanitize the whole settings array.
 *
 * @param mixed $in Submitted values.
 * @return array
 */
function lilahcraft_sanitize_settings( $in ) {
	$d   = lilahcraft_defaults();
	$in  = is_array( $in ) ? wp_unslash( $in ) : array();
	$out = array();

	$out['market_url'] = lilahcraft_clean_url( isset( $in['market_url'] ) ? $in['market_url'] : '' );
	$out['minis_url']  = lilahcraft_clean_url( isset( $in['minis_url'] ) ? $in['minis_url'] : '' );

	// Host name or IP only. Anyone pasting "host:port" gets the port split off.
	$host = strtolower( trim( (string) ( isset( $in['server_host'] ) ? $in['server_host'] : '' ) ) );
	$host = preg_replace( '#^[a-z]+://#', '', $host );
	$port = isset( $in['server_port'] ) ? absint( $in['server_port'] ) : $d['server_port'];
	if ( preg_match( '/^([^:\[\]]+):(\d{1,5})$/', $host, $m ) ) {
		$host = $m[1];
		$port = absint( $m[2] );
	}
	$out['server_host'] = preg_match( '/^[a-z0-9.\-]{1,253}$/', $host ) ? $host : $d['server_host'];
	$out['server_port'] = ( $port >= 1 && $port <= 65535 ) ? $port : $d['server_port'];

	$mc                = trim( (string) ( isset( $in['mc_version'] ) ? $in['mc_version'] : '' ) );
	$out['mc_version'] = preg_match( '/^[0-9A-Za-z.\-]{1,24}$/', $mc ) ? $mc : '';

	$cb                = trim( (string) ( isset( $in['cb_version'] ) ? $in['cb_version'] : '' ) );
	$cb                = ltrim( $cb, 'vV' );
	$out['cb_version'] = preg_match( '/^[0-9A-Za-z.\-]{1,24}$/', $cb ) ? $cb : $d['cb_version'];

	// esc_url_raw() would strip the {placeholders}, so test the pattern with them filled in.
	$pattern = trim( (string) ( isset( $in['cb_url'] ) ? $in['cb_url'] : '' ) );
	$test    = str_replace( array( '{version}', '{mc}', '{loader}' ), array( '0.0.0', '26.2', 'fabric' ), $pattern );
	$valid   = $pattern && ! preg_match( '/[\s"\'<>`]/', $pattern ) && filter_var( $test, FILTER_VALIDATE_URL ) && preg_match( '#^https?://#i', $test );
	$out['cb_url'] = $valid ? $pattern : $d['cb_url'];

	$secs                 = isset( $in['cache_seconds'] ) ? absint( $in['cache_seconds'] ) : $d['cache_seconds'];
	$out['cache_seconds'] = max( 5, min( 3600, $secs ? $secs : $d['cache_seconds'] ) );

	return $out;
}

/**
 * Forget every cached copy when the settings change, so the next request uses them.
 */
function lilahcraft_flush_caches() {
	foreach ( array( 'market', 'minis' ) as $feed ) {
		delete_transient( 'lilahcraft_feed_' . $feed );
		delete_transient( 'lilahcraft_lock_' . $feed );
	}
	delete_transient( 'lilahcraft_status' );
	delete_transient( 'lilahcraft_cb_assets' );
}
add_action( 'update_option_lilahcraft_settings', 'lilahcraft_flush_caches' );
add_action( 'add_option_lilahcraft_settings', 'lilahcraft_flush_caches' );

add_action(
	'admin_init',
	function () {
		register_setting(
			'lilahcraft',
			'lilahcraft_settings',
			array(
				'type'              => 'array',
				'sanitize_callback' => 'lilahcraft_sanitize_settings',
				'default'           => lilahcraft_defaults(),
				'show_in_rest'      => false,
			)
		);

		add_settings_section( 'lilahcraft_feeds', __( 'Live data', 'lilahcraft' ), '__return_false', 'lilahcraft' );
		add_settings_section( 'lilahcraft_server', __( 'Server', 'lilahcraft' ), '__return_false', 'lilahcraft' );
		add_settings_section( 'lilahcraft_downloads', __( 'Downloads', 'lilahcraft' ), '__return_false', 'lilahcraft' );

		$fields = array(
			array( 'market_url', __( 'Market feed URL', 'lilahcraft' ), 'lilahcraft_feeds', 'url', __( 'The HomeCraftMgmt dashboard\'s /api/market address. Leave blank to show labelled sample data.', 'lilahcraft' ) ),
			array( 'minis_url', __( 'Minis feed URL', 'lilahcraft' ), 'lilahcraft_feeds', 'url', __( 'The HomeCraftMgmt dashboard\'s /api/minis address. Leave blank to show labelled sample data.', 'lilahcraft' ) ),
			array( 'cache_seconds', __( 'Cache seconds', 'lilahcraft' ), 'lilahcraft_feeds', 'number', __( 'How long WordPress keeps a copy of each feed before asking again. Visitors never reach your server directly.', 'lilahcraft' ) ),
			array( 'server_host', __( 'Server address', 'lilahcraft' ), 'lilahcraft_server', 'text', __( 'Pinged for the player count in the header. If the ping fails, the count is hidden.', 'lilahcraft' ) ),
			array( 'server_port', __( 'Server port', 'lilahcraft' ), 'lilahcraft_server', 'number', __( 'Java port, usually 25565.', 'lilahcraft' ) ),
			array( 'mc_version', __( 'Minecraft version', 'lilahcraft' ), 'lilahcraft_server', 'text', __( 'The version the server is on, like 26.2. Shown on Downloads. Leave blank to hide that line.', 'lilahcraft' ) ),
			array( 'cb_version', __( 'CraftBridge Client version', 'lilahcraft' ), 'lilahcraft_downloads', 'text', __( 'Shown on Downloads and used in the download link.', 'lilahcraft' ) ),
			array( 'cb_url', __( 'CraftBridge download URL pattern', 'lilahcraft' ), 'lilahcraft_downloads', 'url', __( '{version}, {mc} and {loader} are filled in for each pick. If a file is missing, the button links to the release page instead.', 'lilahcraft' ) ),
		);

		foreach ( $fields as $f ) {
			add_settings_field(
				'lilahcraft_' . $f[0],
				$f[1],
				'lilahcraft_render_field',
				'lilahcraft',
				$f[2],
				array(
					'key'       => $f[0],
					'type'      => $f[3],
					'help'      => $f[4],
					'label_for' => 'lilahcraft_' . $f[0],
				)
			);
		}
	}
);

/**
 * One settings field.
 *
 * @param array $args Field arguments.
 */
function lilahcraft_render_field( $args ) {
	$key   = $args['key'];
	$value = lilahcraft_setting( $key );
	$id    = 'lilahcraft_' . $key;
	$type  = 'number' === $args['type'] ? 'number' : ( 'url' === $args['type'] ? 'url' : 'text' );
	$class = 'number' === $type ? 'small-text' : ( 'url' === $type ? 'large-text code' : 'regular-text' );
	if ( 'cb_url' === $key ) {
		$type = 'text'; // The pattern holds {braces}, which a url input would reject.
	}
	printf(
		'<input type="%1$s" id="%2$s" name="lilahcraft_settings[%3$s]" value="%4$s" class="%5$s" aria-describedby="%2$s_help"%6$s>',
		esc_attr( $type ),
		esc_attr( $id ),
		esc_attr( $key ),
		esc_attr( (string) $value ),
		esc_attr( $class ),
		'number' === $type ? ( 'server_port' === $key ? ' min="1" max="65535"' : ' min="5" max="3600"' ) : ''
	);
	printf( '<p class="description" id="%s_help">%s</p>', esc_attr( $id ), esc_html( $args['help'] ) );

	if ( 'market_url' === $key || 'minis_url' === $key ) {
		$feed = 'market_url' === $key ? 'market' : 'minis';
		$note = lilahcraft_feed_status_text( $feed );
		if ( $note ) {
			printf( '<p class="description"><strong>%s</strong></p>', esc_html( $note ) );
		}
	}
}

/**
 * A plain sentence about the last fetch of a feed, for the settings page.
 *
 * @param string $feed market or minis.
 * @return string
 */
function lilahcraft_feed_status_text( $feed ) {
	if ( ! lilahcraft_setting( $feed . '_url' ) ) {
		return '';
	}
	$st = get_option( 'lilahcraft_feedstat_' . $feed );
	if ( ! is_array( $st ) || empty( $st['time'] ) ) {
		return __( 'Not fetched yet. It is fetched the first time someone opens a page that uses it.', 'lilahcraft' );
	}
	$when = wp_date( get_option( 'time_format' ) . ', ' . get_option( 'date_format' ), (int) $st['time'] );
	if ( ! empty( $st['ok'] ) ) {
		/* translators: %s: time of the fetch. */
		return sprintf( __( 'Last fetch worked at %s.', 'lilahcraft' ), $when );
	}
	/* translators: 1: time of the fetch, 2: error message. */
	return sprintf( __( 'Last fetch failed at %1$s: %2$s', 'lilahcraft' ), $when, (string) $st['error'] );
}

add_action(
	'admin_menu',
	function () {
		add_options_page(
			__( 'LilahCraft', 'lilahcraft' ),
			__( 'LilahCraft', 'lilahcraft' ),
			'manage_options',
			'lilahcraft',
			'lilahcraft_render_settings_page'
		);
	}
);

/**
 * The settings page.
 */
function lilahcraft_render_settings_page() {
	if ( ! current_user_can( 'manage_options' ) ) {
		return;
	}
	?>
	<div class="wrap">
		<h1><?php esc_html_e( 'LilahCraft', 'lilahcraft' ); ?></h1>
		<form action="options.php" method="post">
			<?php
			settings_fields( 'lilahcraft' );
			do_settings_sections( 'lilahcraft' );
			submit_button();
			?>
		</form>
	</div>
	<?php
}
