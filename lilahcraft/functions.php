<?php
/**
 * LilahCraft theme bootstrap.
 *
 * inc/settings.php  Settings > LilahCraft
 * inc/ping.php      Java server list ping for the header status
 * inc/feeds.php     /wp-json/lilahcraft/v1/{market,minis,status}
 * inc/setup.php     creates the pages and sets Reading on activation or update, names the page templates
 * inc/assets.php    styles and scripts, per page
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
require get_template_directory() . '/inc/feeds.php';
require get_template_directory() . '/inc/setup.php';
require get_template_directory() . '/inc/assets.php';
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

// WordPress ends automatic excerpts with " [&hellip;]". No brackets on this site: just the ellipsis.
add_filter(
	'excerpt_more',
	function () {
		return '&hellip;';
	}
);
