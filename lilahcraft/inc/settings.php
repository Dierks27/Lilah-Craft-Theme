<?php
/**
 * Settings > LilahCraft: feed URLs, the server to ping, versions, cache time and the hero style.
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
		'hero_style'    => 'charcoal',
		'feed_token'    => '',
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
 * Field labels, for the settings page and its error messages.
 *
 * @return array
 */
function lilahcraft_setting_labels() {
	return array(
		'market_url'    => __( 'Market feed URL', 'lilahcraft' ),
		'minis_url'     => __( 'Minis feed URL', 'lilahcraft' ),
		'cache_seconds' => __( 'Cache seconds', 'lilahcraft' ),
		'server_host'   => __( 'Server address', 'lilahcraft' ),
		'server_port'   => __( 'Server port', 'lilahcraft' ),
		'mc_version'    => __( 'Minecraft version', 'lilahcraft' ),
		'cb_version'    => __( 'CraftBridge Client version', 'lilahcraft' ),
		'cb_url'        => __( 'CraftBridge download URL pattern', 'lilahcraft' ),
		'hero_style'    => __( 'Hero style', 'lilahcraft' ),
		'feed_token'    => __( 'Feed token', 'lilahcraft' ),
	);
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
 * Clean a feed URL: http or https with a host name, otherwise blank. LAN names with an
 * underscore (http://hcm_dash:8080/api/market) are fine; spaces and quotes are not.
 *
 * @param string $url Raw input.
 * @return string
 */
function lilahcraft_clean_url( $url ) {
	$url   = trim( (string) $url );
	$parts = wp_parse_url( $url );
	if ( preg_match( '/[\s"\'<>`\\\\]/', $url ) || empty( $parts['host'] ) || empty( $parts['scheme'] ) || ! in_array( strtolower( $parts['scheme'] ), array( 'http', 'https' ), true ) ) {
		return '';
	}
	return esc_url_raw( $url, array( 'http', 'https' ) );
}

/**
 * A submitted value failed its check: keep the saved value and say why above the form.
 *
 * @param string $key    Setting name.
 * @param string $reason Why, as the end of a sentence.
 * @return mixed The value saved before.
 */
function lilahcraft_setting_rejected( $key, $reason ) {
	$code   = 'lilahcraft_' . $key;
	$labels = lilahcraft_setting_labels();
	// add_settings_error() only exists in the admin. WordPress sanitizes twice on the very first save: say it once.
	if ( function_exists( 'add_settings_error' ) && ! in_array( $code, wp_list_pluck( get_settings_errors( 'lilahcraft_settings' ), 'code' ), true ) ) {
		/* translators: 1: field label, 2: the reason, a sentence. */
		add_settings_error( 'lilahcraft_settings', $code, sprintf( __( '%1$s was not saved: %2$s The previous value is kept.', 'lilahcraft' ), $labels[ $key ], $reason ) );
	}
	return lilahcraft_setting( $key );
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
	$val = function ( $key ) use ( $in ) {
		return isset( $in[ $key ] ) && is_scalar( $in[ $key ] ) ? trim( (string) $in[ $key ] ) : '';
	};

	// A value that fails its check keeps what was saved before, and the page says why
	// (lilahcraft_setting_rejected). Blank feed URLs are fine: they mean sample data.
	foreach ( array( 'market_url', 'minis_url' ) as $key ) {
		$out[ $key ] = lilahcraft_clean_url( $val( $key ) );
		if ( '' === $out[ $key ] && '' !== $val( $key ) ) {
			$out[ $key ] = lilahcraft_setting_rejected( $key, __( 'it must be a full address starting with http:// or https://, with no spaces or quotes.', 'lilahcraft' ) );
		}
	}

	// Host name or IP only. Anyone pasting "host:port" gets the port split off. Blank means the default.
	$host = preg_replace( '#^[a-z]+://#', '', strtolower( $val( 'server_host' ) ) );
	$port = $val( 'server_port' );
	if ( preg_match( '/^([^:\[\]]+):(\d{1,5})$/', $host, $m ) ) {
		$host = $m[1];
		$port = $m[2];
	}
	if ( '' === $host || preg_match( '/^[a-z0-9.\-]{1,253}$/', $host ) ) {
		$out['server_host'] = '' === $host ? $d['server_host'] : $host;
	} else {
		$out['server_host'] = lilahcraft_setting_rejected( 'server_host', __( 'it must be a host name or IP address, like mc.lilahcraft.com.', 'lilahcraft' ) );
	}
	if ( '' === $port || ( preg_match( '/^\d{1,5}$/', $port ) && (int) $port >= 1 && (int) $port <= 65535 ) ) {
		$out['server_port'] = '' === $port ? $d['server_port'] : (int) $port;
	} else {
		$out['server_port'] = lilahcraft_setting_rejected( 'server_port', __( 'it must be a whole number from 1 to 65535.', 'lilahcraft' ) );
	}

	$mc = $val( 'mc_version' );
	if ( '' === $mc || preg_match( '/^[0-9A-Za-z.\-]{1,24}$/', $mc ) ) {
		$out['mc_version'] = $mc;
	} else {
		$out['mc_version'] = lilahcraft_setting_rejected( 'mc_version', __( 'it can only use letters, numbers, dots and dashes, like 26.2.', 'lilahcraft' ) );
	}

	$cb = ltrim( $val( 'cb_version' ), 'vV' );
	if ( '' === $cb || preg_match( '/^[0-9A-Za-z.\-]{1,24}$/', $cb ) ) {
		$out['cb_version'] = '' === $cb ? $d['cb_version'] : $cb;
	} else {
		$out['cb_version'] = lilahcraft_setting_rejected( 'cb_version', __( 'it can only use letters, numbers, dots and dashes, like 0.4.0.', 'lilahcraft' ) );
	}

	// esc_url_raw() would strip the {placeholders}, so test the pattern with them filled in.
	$pattern = $val( 'cb_url' );
	$test    = str_replace( array( '{version}', '{mc}', '{loader}' ), array( '0.0.0', '26.2', 'fabric' ), $pattern );
	if ( '' === $pattern || '' !== lilahcraft_clean_url( $test ) ) {
		$out['cb_url'] = '' === $pattern ? $d['cb_url'] : $pattern;
	} else {
		$out['cb_url'] = lilahcraft_setting_rejected( 'cb_url', __( 'it must be a full address starting with http:// or https://, with no spaces or quotes.', 'lilahcraft' ) );
	}

	$secs = $val( 'cache_seconds' );
	if ( '' === $secs || ( preg_match( '/^\d{1,4}$/', $secs ) && (int) $secs >= 5 && (int) $secs <= 3600 ) ) {
		$out['cache_seconds'] = '' === $secs ? $d['cache_seconds'] : (int) $secs;
	} else {
		$out['cache_seconds'] = lilahcraft_setting_rejected( 'cache_seconds', __( 'it must be a whole number from 5 to 3600.', 'lilahcraft' ) );
	}

	// A shared secret for HomeCraftMgmt: printable, no spaces. Blank means none.
	$token = $val( 'feed_token' );
	if ( '' === $token || preg_match( '/^[\x21-\x7E]{8,200}$/', $token ) ) {
		$out['feed_token'] = $token;
	} else {
		$out['feed_token'] = lilahcraft_setting_rejected( 'feed_token', __( 'it must be 8 to 200 characters with no spaces.', 'lilahcraft' ) );
	}

	// Only the two looks the design draws.
	$hero = $val( 'hero_style' );
	if ( '' === $hero || in_array( $hero, array( 'charcoal', 'light' ), true ) ) {
		$out['hero_style'] = '' === $hero ? $d['hero_style'] : $hero;
	} else {
		$out['hero_style'] = lilahcraft_setting_rejected( 'hero_style', __( 'pick Charcoal or Light.', 'lilahcraft' ) );
	}

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
// update_option() skips the hooks above when nothing changed, but saving is also how to force a re-check
// (a download that was missing an hour ago, a feed that just came back), so flush on every save.
add_filter(
	'pre_update_option_lilahcraft_settings',
	function ( $value ) {
		lilahcraft_flush_caches();
		return $value;
	}
);

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
		add_settings_section( 'lilahcraft_look', __( 'Look', 'lilahcraft' ), '__return_false', 'lilahcraft' );

		$l      = lilahcraft_setting_labels();
		$fields = array(
			array( 'market_url', $l['market_url'], 'lilahcraft_feeds', 'url', __( 'The HomeCraftMgmt dashboard\'s /api/market address. Leave blank to show labelled sample data.', 'lilahcraft' ) ),
			array( 'minis_url', $l['minis_url'], 'lilahcraft_feeds', 'url', __( 'The HomeCraftMgmt dashboard\'s /api/minis address. Leave blank to show labelled sample data.', 'lilahcraft' ) ),
			array( 'feed_token', $l['feed_token'], 'lilahcraft_feeds', 'password', __( 'Optional. If HomeCraftMgmt is set up with a token, paste the same token here: WordPress sends it with every feed request (as Authorization: Bearer). Visitors never see it. Leave blank for none.', 'lilahcraft' ) ),
			array( 'cache_seconds', $l['cache_seconds'], 'lilahcraft_feeds', 'number', __( 'How long WordPress keeps a copy of each feed before asking again. Visitors never reach your server directly.', 'lilahcraft' ) ),
			array( 'server_host', $l['server_host'], 'lilahcraft_server', 'text', __( 'Pinged for the player count in the header. If the ping fails, the count is hidden.', 'lilahcraft' ) ),
			array( 'server_port', $l['server_port'], 'lilahcraft_server', 'number', __( 'Java port, usually 25565.', 'lilahcraft' ) ),
			array( 'mc_version', $l['mc_version'], 'lilahcraft_server', 'text', __( 'The version the server is on, like 26.2. Shown on Downloads. Leave blank to hide that line.', 'lilahcraft' ) ),
			array( 'cb_version', $l['cb_version'], 'lilahcraft_downloads', 'text', __( 'Shown on Downloads and used in the download link.', 'lilahcraft' ) ),
			array( 'cb_url', $l['cb_url'], 'lilahcraft_downloads', 'url', __( '{version}, {mc} and {loader} are filled in for each pick. If a file is missing, the button links to the release page instead.', 'lilahcraft' ) ),
			array( 'hero_style', $l['hero_style'], 'lilahcraft_look', 'select', __( 'The top band of every page and the header: charcoal with white text, or light gray with charcoal text.', 'lilahcraft' ) ),
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
	if ( 'password' === $args['type'] ) {
		printf(
			'<input type="password" id="%1$s" name="lilahcraft_settings[%2$s]" value="%3$s" class="regular-text code" autocomplete="new-password" spellcheck="false" aria-describedby="%1$s_help">',
			esc_attr( $id ),
			esc_attr( $key ),
			esc_attr( (string) $value )
		);
		printf( '<p class="description" id="%s_help">%s</p>', esc_attr( $id ), esc_html( $args['help'] ) );
		// A token sent over plain http to somewhere on the internet can be read on the way.
		if ( '' !== (string) $value ) {
			foreach ( array( 'market_url', 'minis_url' ) as $feed_key ) {
				$feed_url = (string) lilahcraft_setting( $feed_key );
				$host     = (string) wp_parse_url( $feed_url, PHP_URL_HOST );
				$is_http  = 0 === stripos( $feed_url, 'http://' );
				$is_local = '' === $host || false === strpos( $host, '.' ) || preg_match( '/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/', $host );
				if ( $is_http && ! $is_local ) {
					printf( '<p class="description"><strong>%s</strong></p>', esc_html__( 'A feed address starts with http://, so the token travels unencrypted. Use https:// if the feed crosses the internet.', 'lilahcraft' ) );
					break;
				}
			}
		}
		return;
	}
	if ( 'select' === $args['type'] ) {
		$options = array(
			'charcoal' => __( 'Charcoal (default)', 'lilahcraft' ),
			'light'    => __( 'Light', 'lilahcraft' ),
		);
		printf( '<select id="%1$s" name="lilahcraft_settings[%2$s]" aria-describedby="%1$s_help">', esc_attr( $id ), esc_attr( $key ) );
		foreach ( $options as $opt => $label ) {
			printf( '<option value="%s"%s>%s</option>', esc_attr( $opt ), selected( $value, $opt, false ), esc_html( $label ) );
		}
		echo '</select>';
		printf( '<p class="description" id="%s_help">%s</p>', esc_attr( $id ), esc_html( $args['help'] ) );
		return;
	}
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
		// 8em wide: WordPress's small-text (65 px) cuts the port 25565 to "2556".
		'number' === $type ? ( 'server_port' === $key ? ' min="1" max="65535"' : ' min="5" max="3600"' ) . ' style="width:8em"' : ''
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
	// A note about another URL (the one before a change) says nothing about this one.
	if ( ! is_array( $st ) || empty( $st['time'] ) || ! isset( $st['url'] ) || lilahcraft_setting( $feed . '_url' ) !== $st['url'] ) {
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
