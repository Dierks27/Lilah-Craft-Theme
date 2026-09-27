<?php
/**
 * Pages and Reading settings.
 *
 * On activation, and once after an in-place update (Replace installed with uploaded does not fire
 * after_switch_theme), create any missing site page and set Reading: front page = Home,
 * posts page = News. Existing pages and posts are never changed; only an unattached Media Library
 * file that holds a missing page's address has its slug moved aside. The in-place run happens on
 * the first request of any kind after the upload, so the pages exist before a visitor reaches them.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Whether this theme is the site's active theme, not just being previewed (Appearance > Themes >
 * Live Preview, or the Customizer). A preview loads functions.php and filters get_stylesheet(),
 * but must not change the site: no pages, no Reading, no background job.
 *
 * @return bool
 */
function lilahcraft_is_active_theme() {
	global $wp_customize;
	if ( $wp_customize instanceof WP_Customize_Manager && ! $wp_customize->is_theme_active() ) {
		return false;
	}
	return get_option( 'stylesheet' ) === get_stylesheet();
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

// The Site Editor lists page-{slug} templates by their raw slug. Name them like core's own ("Page: Play").
add_filter(
	'default_template_types',
	function ( $types ) {
		foreach ( lilahcraft_pages() as $slug => $title ) {
			if ( 'home' === $slug || 'news' === $slug ) {
				continue; // front-page.html and home.html already have core's names.
			}
			$types[ 'page-' . $slug ] = array(
				/* translators: %s: page name, like Play. */
				'title'       => sprintf( __( 'Page: %s', 'lilahcraft' ), $title ),
				/* translators: %s: page name, like Play. */
				'description' => sprintf( __( 'The %s page.', 'lilahcraft' ), $title ),
			);
		}
		return $types;
	}
);

/**
 * Create missing pages and set Reading.
 */
function lilahcraft_setup_site() {
	global $wpdb;

	// From a visitor's page load there is no user: credit the pages to the first administrator.
	$author = get_current_user_id();
	if ( ! $author ) {
		$admins = get_users(
			array(
				'role'    => 'administrator',
				'number'  => 1,
				'fields'  => 'ID',
				'orderby' => 'ID',
			)
		);
		$author = $admins ? (int) $admins[0] : 0;
	}

	$ids       = array();
	$conflicts = array();
	foreach ( lilahcraft_pages() as $slug => $title ) {
		// Pages only: with a plain 'page', WordPress also matches a Media Library file with this slug.
		$page = get_page_by_path( $slug, OBJECT, array( 'page' ) );
		if ( $page ) {
			$ids[ $slug ] = $page;
			continue;
		}
		// An unattached upload such as arcade.png holds the top-level slug "arcade", which would push the
		// new page to "arcade-2" (and off its template). Move the file's slug aside; the file is untouched.
		$file = get_page_by_path( $slug, OBJECT, array( 'attachment' ) );
		if ( $file && 0 === (int) $file->post_parent ) {
			$wpdb->update( $wpdb->posts, array( 'post_name' => wp_unique_post_slug( $slug . '-image', $file->ID, $file->post_status, 'attachment', 0 ) ), array( 'ID' => $file->ID ) );
			clean_post_cache( $file->ID );
		}
		$id = wp_insert_post(
			array(
				'post_type'      => 'page',
				'post_status'    => 'publish',
				'post_title'     => $title,
				'post_name'      => $slug,
				'post_author'    => $author,
				'post_content'   => '',
				'comment_status' => 'closed',
				'ping_status'    => 'closed',
			),
			true
		);
		if ( ! is_wp_error( $id ) ) {
			$ids[ $slug ] = get_post( $id );
			if ( $ids[ $slug ]->post_name !== $slug ) {
				$conflicts[] = $slug;
			}
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

	if ( $conflicts ) {
		update_option( 'lilahcraft_setup_conflicts', $conflicts, false );
	}
	// Autoloaded: every request checks it (lilahcraft_setup_once).
	update_option( 'lilahcraft_setup', 2, true );
}

/**
 * Take the setup lock. add_option() is not atomic (it runs INSERT ... ON DUPLICATE KEY UPDATE), so
 * this takes it the way WP_Upgrader::create_lock() does: INSERT IGNORE succeeds for one request only.
 * A lock older than a minute was left by a request that died, and one request may take it over.
 *
 * @return bool Whether this request holds the lock.
 */
function lilahcraft_setup_lock() {
	global $wpdb;
	$now = time();
	if ( $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO `$wpdb->options` ( `option_name`, `option_value`, `autoload` ) VALUES ( 'lilahcraft_setup_running', %s, 'off' )", $now ) ) ) {
		return true;
	}
	$since = (int) $wpdb->get_var( "SELECT option_value FROM `$wpdb->options` WHERE option_name = 'lilahcraft_setup_running'" );
	return $since && $now - $since > 60
		&& (bool) $wpdb->query( $wpdb->prepare( "UPDATE `$wpdb->options` SET option_value = %s WHERE option_name = 'lilahcraft_setup_running' AND option_value = %s", $now, $since ) );
}

/**
 * Run the setup under the lock, so two requests arriving together can't both create the pages.
 *
 * @param bool $always Run even when it has run before (theme activation).
 */
function lilahcraft_setup_once( $always = false ) {
	global $wpdb;
	if ( ( ! $always && (int) get_option( 'lilahcraft_setup', 0 ) >= 2 ) || ! lilahcraft_setup_lock() ) {
		return;
	}
	// Ask the database again: another request may have finished the setup just before this one took the lock.
	if ( $always || (int) $wpdb->get_var( "SELECT option_value FROM `$wpdb->options` WHERE option_name = 'lilahcraft_setup'" ) < 2 ) {
		lilahcraft_setup_site();
	}
	delete_option( 'lilahcraft_setup_running' );
}

add_action(
	'after_switch_theme',
	function () {
		lilahcraft_setup_once( true );
	}
);

// Uploading a new version over the active theme does not "switch" themes, so run once on the first
// request of any kind (front end, admin, REST or cron) after it. Never while only previewed.
add_action(
	'wp_loaded',
	function () {
		if ( ! lilahcraft_is_active_theme() ) {
			return;
		}
		// When this site first ran the 2.1 look (autoloaded, so the check is free after that).
		if ( ! get_option( 'lilahcraft_look_since' ) ) {
			update_option( 'lilahcraft_look_since', time(), true );
		}
		lilahcraft_setup_once();
	}
);

/**
 * Templates and parts saved in Appearance > Editor before this site first ran the 2.1 look. They
 * still hold the 2.0 markup (no hero band, no texture) and override the theme's new files until
 * they're reset. Ones the current user hid are left out.
 *
 * @return array post ID => title
 */
function lilahcraft_old_templates() {
	$since = (int) get_option( 'lilahcraft_look_since' );
	$old   = array();
	if ( ! $since ) {
		return $old;
	}
	$posts = get_posts(
		array(
			'post_type'      => array( 'wp_template', 'wp_template_part' ),
			'post_status'    => 'publish',
			'posts_per_page' => 50,
			'no_found_rows'  => true,
			'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
				array(
					'taxonomy' => 'wp_theme',
					'field'    => 'slug',
					'terms'    => get_stylesheet(),
				),
			),
			'date_query'     => array(
				array(
					'column' => 'post_modified_gmt',
					'before' => gmdate( 'Y-m-d H:i:s', $since ),
				),
			),
		)
	);
	$hidden = array_map( 'intval', (array) get_user_meta( get_current_user_id(), 'lilahcraft_hidden_templates', true ) );
	foreach ( $posts as $p ) {
		// Only edits of the theme's own templates: one Jeff made from scratch has no newer copy to miss.
		$file = ( 'wp_template' === $p->post_type ? 'templates/' : 'parts/' ) . $p->post_name . '.html';
		if ( ! in_array( $p->ID, $hidden, true ) && file_exists( get_theme_file_path( $file ) ) ) {
			$old[ $p->ID ] = '' !== $p->post_title ? $p->post_title : $p->post_name;
		}
	}
	return $old;
}

// "Hide this notice" on the old-templates notice below: for this user, and only for the ones listed now.
add_action(
	'admin_init',
	function () {
		if ( ! isset( $_GET['lilahcraft_hide_old_templates'] ) || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		check_admin_referer( 'lilahcraft_hide_old_templates' );
		$user   = get_current_user_id();
		$hidden = (array) get_user_meta( $user, 'lilahcraft_hidden_templates', true );
		update_user_meta( $user, 'lilahcraft_hidden_templates', array_values( array_unique( array_merge( array_map( 'intval', $hidden ), array_keys( lilahcraft_old_templates() ) ) ) ) );
		wp_safe_redirect( remove_query_arg( array( 'lilahcraft_hide_old_templates', '_wpnonce' ) ) );
		exit;
	}
);

// An update from 2.0 leaves any template edited under 2.0 in the old layout, with no warning anywhere else.
add_action(
	'admin_notices',
	function () {
		if ( ! current_user_can( 'manage_options' ) || ! lilahcraft_is_active_theme() ) {
			return;
		}
		$old = lilahcraft_old_templates();
		if ( ! $old ) {
			return;
		}
		printf(
			'<div class="notice notice-warning"><p>%1$s</p><p><a href="%2$s">%3$s</a> &middot; <a href="%4$s">%5$s</a></p></div>',
			/* translators: %s: template names, like Page: Arcade, Header. */
			esc_html( sprintf( __( 'These templates were changed in Appearance → Editor before LilahCraft 2.1, so they still show the 2.0 layout without the new look: %s. Open each one, choose ⋮ → Reset, then redo any text changes.', 'lilahcraft' ), implode( ', ', array_map( 'wp_specialchars_decode', $old ) ) ) ),
			esc_url( admin_url( 'site-editor.php?postType=wp_template' ) ),
			esc_html__( 'Open the templates', 'lilahcraft' ),
			esc_url( wp_nonce_url( add_query_arg( 'lilahcraft_hide_old_templates', '1' ), 'lilahcraft_hide_old_templates' ) ),
			esc_html__( 'Hide this notice', 'lilahcraft' )
		);
	}
);

// If something other than a Media Library file already held a page's address, say so until it's sorted.
add_action(
	'admin_notices',
	function () {
		$slugs = get_option( 'lilahcraft_setup_conflicts' );
		if ( ! $slugs || ! current_user_can( 'manage_options' ) ) {
			return;
		}
		$left = array();
		foreach ( (array) $slugs as $slug ) {
			if ( ! get_page_by_path( $slug, OBJECT, array( 'page' ) ) ) {
				$left[] = '/' . $slug . '/';
			}
		}
		if ( ! $left ) {
			delete_option( 'lilahcraft_setup_conflicts' );
			return;
		}
		printf(
			'<div class="notice notice-warning"><p>%s</p></div>',
			/* translators: %s: page addresses, like /arcade/. */
			esc_html( sprintf( __( 'LilahCraft could not give every page its address, because something else already uses %s. Rename or remove that item, then change the page\'s slug back so it gets its layout and the menu link works.', 'lilahcraft' ), implode( ', ', $left ) ) )
		);
	}
);
