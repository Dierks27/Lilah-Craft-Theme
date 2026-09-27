<?php
/**
 * Share cards and descriptions: what Discord, iMessage and search engines show for a link.
 *
 * Each page gets a description and a 1200×630 card from assets/img/og/{page}.png in the Pixel pop look;
 * a news post uses its own excerpt (and its featured image, if it has one). Skipped when an SEO plugin
 * is active, so the tags are never doubled.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Whether an SEO plugin already prints these tags.
 *
 * @return bool
 */
function lilahcraft_seo_plugin_active() {
	return defined( 'WPSEO_VERSION' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'AIOSEO_VERSION' )
		|| defined( 'SEOPRESS_VERSION' ) || function_exists( 'the_seo_framework' ) || defined( 'SLIM_SEO_VER' );
}

/**
 * The description for each page of the site.
 *
 * @return array key => sentence
 */
function lilahcraft_page_descriptions() {
	return array(
		'home'      => __( 'A family Minecraft server for Java and Bedrock where every block is worth something. Mine it, sell it, watch the price move.', 'lilahcraft' ),
		'play'      => __( 'Pick your kind of Minecraft and you’re in within a minute. Java and Bedrock land in the same hub: mc.lilahcraft.com.', 'lilahcraft' ),
		'downloads' => __( 'Optional extras for Java players: the CraftBridge Client mod, resource packs and recommended mods.', 'lilahcraft' ),
		'market'    => __( 'Live prices from the LilahCraft market. Every raw item has real stock: sell some in and the price drops.', 'lilahcraft' ),
		'minis'     => __( 'Every numbered Mini on LilahCraft: how rare it is, how many are printed and how many are left.', 'lilahcraft' ),
		'arcade'    => __( 'Tokens are the Arcade’s coins. You earn them by playing, and they never cost or turn into money.', 'lilahcraft' ),
		'guide'     => __( 'Everything on the LilahCraft server in plain words: the PC, the market, towns, crafting and commands.', 'lilahcraft' ),
		'news'      => __( 'Updates, new Minis and events on the LilahCraft server.', 'lilahcraft' ),
	);
}

add_action(
	'wp_head',
	function () {
		if ( lilahcraft_seo_plugin_active() || ! apply_filters( 'lilahcraft_share_tags', true ) ) {
			return;
		}
		$key   = lilahcraft_page_key();
		$descs = lilahcraft_page_descriptions();
		$type  = 'website';
		$image = get_theme_file_uri( 'assets/img/og/' . ( $key ? $key : 'home' ) . '.png' );
		$desc  = isset( $descs[ $key ] ) ? $descs[ $key ] : $descs['home'];
		$url   = home_url( ! empty( $GLOBALS['wp']->request ) ? user_trailingslashit( $GLOBALS['wp']->request ) : '/' );

		if ( is_singular() ) {
			$url = wp_get_canonical_url();
		}
		if ( is_singular( 'post' ) ) {
			$type    = 'article';
			$excerpt = trim( wp_strip_all_tags( get_the_excerpt() ) );
			if ( '' !== $excerpt ) {
				$desc = wp_html_excerpt( $excerpt, 200, '…' );
			}
			if ( has_post_thumbnail() ) {
				$thumb = wp_get_attachment_image_url( get_post_thumbnail_id(), 'large' );
				$image = $thumb ? $thumb : $image;
			}
		} elseif ( is_front_page() ) {
			$url = home_url( '/' );
		}

		$tags = array(
			array( 'name', 'description', $desc ),
			array( 'property', 'og:site_name', get_bloginfo( 'name' ) ),
			array( 'property', 'og:type', $type ),
			array( 'property', 'og:title', wp_get_document_title() ),
			array( 'property', 'og:description', $desc ),
			array( 'property', 'og:url', $url ),
			array( 'property', 'og:image', $image ),
			array( 'property', 'og:image:width', '1200' ),
			array( 'property', 'og:image:height', '630' ),
			array( 'name', 'twitter:card', 'summary_large_image' ),
		);
		if ( is_singular( 'post' ) && has_post_thumbnail() ) {
			$tags = array_values(
				array_filter(
					$tags,
					function ( $t ) {
						return ! in_array( $t[1], array( 'og:image:width', 'og:image:height' ), true );
					}
				)
			);
		}
		foreach ( $tags as $t ) {
			printf( '<meta %s="%s" content="%s">' . "\n", esc_attr( $t[0] ), esc_attr( $t[1] ), 'og:url' === $t[1] || 'og:image' === $t[1] ? esc_url( $t[2] ) : esc_attr( $t[2] ) );
		}
	},
	5
);
