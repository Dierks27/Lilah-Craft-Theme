<?php
/**
 * lilahcraft/site-header: logo, main nav with the current page marked, the live player count
 * (the address and its copy button live in each page's hero and the join bar). Below 1150 px the nav folds behind a Menu button (assets/js/site.js).
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * URL of a site page by slug, falling back to /slug/ before the page exists.
 *
 * The site's published top-level pages are loaded in one query per request (pages only, so a
 * Media Library file with the same slug is never taken for the page).
 *
 * @param string $slug Page slug.
 * @return string
 */
function lilahcraft_page_url( $slug ) {
	static $urls = null;
	if ( 'news' === $slug && (int) get_option( 'page_for_posts' ) ) {
		return get_permalink( (int) get_option( 'page_for_posts' ) );
	}
	if ( null === $urls ) {
		$urls  = array();
		$pages = get_posts(
			array(
				'post_type'              => array( 'page' ),
				'post_status'            => 'publish',
				'post_name__in'          => array_keys( lilahcraft_pages() ),
				'post_parent'            => 0,
				'posts_per_page'         => 20,
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);
		foreach ( $pages as $page ) {
			$urls[ $page->post_name ] = get_permalink( $page );
		}
	}
	return isset( $urls[ $slug ] ) ? $urls[ $slug ] : home_url( '/' . $slug . '/' );
}

/**
 * Render the header.
 *
 * @return string
 */
function lilahcraft_render_site_header() {
	$current = function_exists( 'lilahcraft_page_key' ) ? lilahcraft_page_key() : '';
	$items   = array(
		'play'      => __( 'Play', 'lilahcraft' ),
		'downloads' => __( 'Downloads', 'lilahcraft' ),
		'market'    => __( 'Market', 'lilahcraft' ),
		'minis'     => __( 'Minis', 'lilahcraft' ),
		'arcade'    => __( 'Arcade', 'lilahcraft' ),
		'guide'     => __( 'Guide', 'lilahcraft' ),
		'news'      => __( 'News', 'lilahcraft' ),
	);

	$links = '';
	foreach ( $items as $slug => $label ) {
		$attr = '';
		if ( $slug === $current ) {
			// The News page itself is the page; a post or topic inside News is only "in" it.
			$attr = ( 'news' === $slug && ! is_home() ) ? ' aria-current="true"' : ' aria-current="page"';
		}
		$links .= sprintf( '<li><a href="%s"%s>%s</a></li>', esc_url( lilahcraft_page_url( $slug ) ), $attr, esc_html( $label ) );
	}

	ob_start();
	?>
<header class="lc-top" data-lc-header>
	<div class="lc-top-in">
		<a class="lc-mark" href="<?php echo esc_url( home_url( '/' ) ); ?>"<?php echo 'home' === $current ? ' aria-current="page"' : ''; ?>><span class="lc-logo" aria-hidden="true"><i></i><i></i><i></i><i></i></span>LilahCraft</a>
		<button class="lc-menu-btn" type="button" aria-expanded="false" aria-controls="lc-menu" data-lc-menu-btn>
			<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
			<span><?php esc_html_e( 'Menu', 'lilahcraft' ); ?></span>
		</button>
		<div class="lc-menu" id="lc-menu" data-lc-menu>
			<nav class="lc-nav" aria-label="<?php esc_attr_e( 'Main', 'lilahcraft' ); ?>"><ul><?php echo $links; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts above. ?></ul></nav>
			<div class="lc-tools">
				<p class="lc-status" data-lc-status hidden><span class="lc-dot" aria-hidden="true"></span><span data-lc-status-text></span></p>
			</div>
		</div>
	</div>
</header>
	<?php
	return trim( ob_get_clean() );
}

lilahcraft_register_block( 'lilahcraft/site-header', __( 'LilahCraft header', 'lilahcraft' ), 'lilahcraft_render_site_header', __( 'Logo, main navigation and the player count.', 'lilahcraft' ) );
