<?php
/**
 * Pages and Reading settings.
 *
 * On activation, and once after an in-place update (Replace active with uploaded does not fire
 * after_switch_theme), create any missing site page and set Reading: front page = Home,
 * posts page = News. Existing pages and posts are never changed.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The site's pages, slug => title, in menu order.
 *
 * @return array
 */
function lilahcraft_pages() {
	return array(
		'home'      => __( 'Home', 'lilahcraft' ),
		'play'      => __( 'Play', 'lilahcraft' ),
		'downloads' => __( 'Downloads', 'lilahcraft' ),
		'market'    => __( 'Market', 'lilahcraft' ),
		'minis'     => __( 'Minis', 'lilahcraft' ),
		'arcade'    => __( 'Arcade', 'lilahcraft' ),
		'guide'     => __( 'Guide', 'lilahcraft' ),
		'news'      => __( 'News', 'lilahcraft' ),
	);
}

/**
 * Create missing pages and set Reading.
 */
function lilahcraft_setup_site() {
	$ids = array();
	foreach ( lilahcraft_pages() as $slug => $title ) {
		$page = get_page_by_path( $slug, OBJECT, 'page' );
		if ( $page ) {
			$ids[ $slug ] = $page;
			continue;
		}
		$id = wp_insert_post(
			array(
				'post_type'      => 'page',
				'post_status'    => 'publish',
				'post_title'     => $title,
				'post_name'      => $slug,
				'post_content'   => '',
				'comment_status' => 'closed',
				'ping_status'    => 'closed',
			),
			true
		);
		if ( ! is_wp_error( $id ) ) {
			$ids[ $slug ] = get_post( $id );
		}
	}

	// Only point Reading at published pages, or visitors would get a 404.
	if ( ! empty( $ids['home'] ) && 'publish' === $ids['home']->post_status ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', (int) $ids['home']->ID );
	}
	if ( ! empty( $ids['news'] ) && 'publish' === $ids['news']->post_status ) {
		update_option( 'page_for_posts', (int) $ids['news']->ID );
	}

	update_option( 'lilahcraft_setup', 2, false );
}
add_action( 'after_switch_theme', 'lilahcraft_setup_site' );

// Uploading a new version over the active theme does not "switch" themes, so run once here too.
add_action(
	'admin_init',
	function () {
		if ( (int) get_option( 'lilahcraft_setup', 0 ) < 2 && current_user_can( 'manage_options' ) ) {
			lilahcraft_setup_site();
		}
	}
);
