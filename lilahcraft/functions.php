<?php
/**
 * LilahCraft theme bootstrap.
 *
 * inc/settings.php  Settings > LilahCraft
 * inc/ping.php      Java server list ping for the header status
 * inc/activity.php  player counts over the day ("When are people on?" on Play)
 * inc/feeds.php     /wp-json/lilahcraft/v1/{market,minis,status}
 * inc/setup.php     creates the pages and sets Reading on activation or update, names the page templates
 * inc/assets.php    styles and scripts, per page
 * inc/meta.php      descriptions and share cards (og:image) per page
 * inc/blocks.php    theme blocks rendered in PHP (inc/blocks/*.php)
 * inc/updater.php   theme updates from the GitHub releases (Update URI in style.css)
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

require get_template_directory() . '/inc/settings.php';
require get_template_directory() . '/inc/ping.php';
require get_template_directory() . '/inc/activity.php';
require get_template_directory() . '/inc/feeds.php';
require get_template_directory() . '/inc/setup.php';
require get_template_directory() . '/inc/assets.php';
require get_template_directory() . '/inc/meta.php';
require get_template_directory() . '/inc/blocks.php';
require get_template_directory() . '/inc/updater.php';

add_action(
	'after_setup_theme',
	function () {
		add_theme_support( 'editor-styles' );
		add_theme_support( 'responsive-embeds' );
	}
);

add_action(
	'init',
	function () {
		register_block_pattern_category( 'lilahcraft', array( 'label' => __( 'LilahCraft', 'lilahcraft' ) ) );
	}
);

// Settings > LilahCraft > Hero style: Light swaps the hero and header tokens (site.css .lc-hero-light).
add_filter(
	'body_class',
	function ( $classes ) {
		if ( 'light' === lilahcraft_setting( 'hero_style' ) ) {
			$classes[] = 'lc-hero-light';
		}
		return $classes;
	}
);

// The editor canvas has no such body class, so with Light saved it gets the same rules: every rule in the
// theme's styles that needs .lc-hero-light, with body in its place (the editor scopes body to its canvas).
add_filter(
	'block_editor_settings_all',
	function ( $settings ) {
		if ( 'light' !== lilahcraft_setting( 'hero_style' ) ) {
			return $settings;
		}
		$pages = glob( get_theme_file_path( 'assets/css/page-*.css' ) );
		foreach ( array_merge( array( get_theme_file_path( 'assets/css/site.css' ) ), $pages ? $pages : array() ) as $file ) {
			$css = lilahcraft_hero_light_css( (string) file_get_contents( $file ) );
			if ( '' !== $css ) {
				$settings['styles'][] = array(
					'css'            => $css,
					'baseURL'        => get_theme_file_uri( 'assets/css/' . basename( $file ) ), // For the url(../img/…) textures.
					'__unstableType' => 'theme',
					'isGlobalStyles' => false,
				);
			}
		}
		return $settings;
	}
);

/**
 * The Hero style: Light rules of a stylesheet, for the editor: each rule whose selector has
 * .lc-hero-light, rewritten for body. Rules inside @media (or @supports, @container) keep it.
 *
 * @param string $css A stylesheet.
 * @return string
 */
function lilahcraft_hero_light_css( $css ) {
	$css = preg_replace( '#/\*.*?\*/#s', '', $css );
	$out = '';
	// Those blocks first (one level of rules inside), then take them out and read the top-level rules.
	if ( preg_match_all( '/(@(?:media|supports|container)[^{]*)\{((?:[^{}]*\{[^{}]*\})*)[^{}]*\}/', $css, $blocks, PREG_SET_ORDER ) ) {
		foreach ( $blocks as $b ) {
			$inner = lilahcraft_hero_light_css( $b[2] );
			$out  .= '' !== $inner ? trim( $b[1] ) . '{' . $inner . "}\n" : '';
			$css   = str_replace( $b[0], '', $css );
		}
	}
	if ( preg_match_all( '/[^{}]*\.lc-hero-light(?![\w-])[^{}]*\{[^{}]*\}/', $css, $rules ) ) {
		foreach ( $rules[0] as $rule ) {
			$out .= preg_replace( '/(?:body)?\.lc-hero-light(?![\w-])/', 'body', trim( $rule ) ) . "\n";
		}
	}
	return $out;
}

// WordPress ends automatic excerpts with " [&hellip;]". No brackets on this site: just the ellipsis.
add_filter(
	'excerpt_more',
	function () {
		return '&hellip;';
	}
);
