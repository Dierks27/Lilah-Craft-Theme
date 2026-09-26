<?php
/**
 * Styles and scripts.
 *
 * Every page gets assets/css/site.css and assets/js/site.js. A page also gets
 * assets/css/page-{key}.css and assets/js/page-{key}.js when those files exist, where
 * {key} comes from lilahcraft_page_key(). Home, Market and Minis also get assets/js/lc-data.js.
 * URLs carry ?ver= with the theme Version, so bump it on every release.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Which page of the site this request is: home, play, downloads, market, minis, arcade,
 * guide, news, or '' for anything else. Posts and archives count as news.
 *
 * @return string
 */
function lilahcraft_page_key() {
	if ( is_front_page() ) {
		return 'home';
	}
	foreach ( array( 'play', 'downloads', 'market', 'minis', 'arcade', 'guide' ) as $slug ) {
		if ( is_page( $slug ) ) {
			return $slug;
		}
	}
	if ( is_home() || is_singular( 'post' ) || is_archive() || is_search() ) {
		return 'news';
	}
	return '';
}

/**
 * Theme version, for ?ver=.
 *
 * @return string
 */
function lilahcraft_version() {
	return (string) wp_get_theme( get_template() )->get( 'Version' );
}

/**
 * Google Fonts, as in 1.0.
 *
 * @return string
 */
function lilahcraft_fonts_url() {
	return 'https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@500;600&display=swap';
}

add_action(
	'wp_enqueue_scripts',
	function () {
		$v   = lilahcraft_version();
		$key = lilahcraft_page_key();

		wp_enqueue_style( 'lilahcraft-fonts', lilahcraft_fonts_url(), array(), null ); // phpcs:ignore WordPress.WP.EnqueuedResourceParameters.MissingVersion
		wp_enqueue_style( 'lilahcraft', get_theme_file_uri( 'assets/css/site.css' ), array( 'lilahcraft-fonts' ), $v );

		wp_enqueue_script( 'lilahcraft', get_theme_file_uri( 'assets/js/site.js' ), array(), $v, true );
		wp_add_inline_script(
			'lilahcraft',
			'window.LC=' . wp_json_encode(
				array(
					'rest'         => esc_url_raw( rest_url( 'lilahcraft/v1/' ) ),
					'cacheSeconds' => (int) lilahcraft_setting( 'cache_seconds' ),
				)
			) . ';',
			'before'
		);

		$deps = array( 'lilahcraft' );
		if ( in_array( $key, array( 'home', 'market', 'minis' ), true ) ) {
			wp_enqueue_script( 'lilahcraft-data', get_theme_file_uri( 'assets/js/lc-data.js' ), array( 'lilahcraft' ), $v, true );
			$deps[] = 'lilahcraft-data';
		}

		if ( $key && file_exists( get_theme_file_path( "assets/css/page-$key.css" ) ) ) {
			wp_enqueue_style( "lilahcraft-$key", get_theme_file_uri( "assets/css/page-$key.css" ), array( 'lilahcraft' ), $v );
		}
		if ( $key && file_exists( get_theme_file_path( "assets/js/page-$key.js" ) ) ) {
			wp_enqueue_script( "lilahcraft-$key", get_theme_file_uri( "assets/js/page-$key.js" ), $deps, $v, true );
		}
	},
	20
);

// Mark the page as scripted before it paints, so the menu and live widgets never flash.
add_action(
	'wp_head',
	function () {
		echo "<script>document.documentElement.className+=' lc-js';</script>\n";
	},
	1
);

add_filter(
	'wp_resource_hints',
	function ( $urls, $type ) {
		if ( 'preconnect' === $type ) {
			$urls[] = array(
				'href'        => 'https://fonts.gstatic.com',
				'crossorigin' => 'anonymous',
			);
		}
		return $urls;
	},
	10,
	2
);

// The block editor shows the same fonts and styles, page files included.
add_action(
	'after_setup_theme',
	function () {
		$files = array( lilahcraft_fonts_url(), 'assets/css/site.css' );
		foreach ( glob( get_theme_file_path( 'assets/css/page-*.css' ) ) as $file ) {
			$files[] = 'assets/css/' . basename( $file );
		}
		$files[] = 'assets/css/editor.css';
		add_editor_style( $files );
	}
);
