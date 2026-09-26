<?php
/**
 * News: the lilahcraft/topics block, plus two small helpers for the News templates
 * (templates/home.html, single.html, archive.html).
 *
 * lilahcraft/topics  The sidebar "Topics" card: every category that has published posts, each a
 *                    row link with its real post count. The current topic is marked with
 *                    aria-current on its archive. No topics with posts: the block renders nothing.
 *
 * Post meta          A Post Terms block with the class lc-news-topic prints only the post's first
 *                    category, as plain text, so a news card stays one link. Its prefix is kept.
 *
 * Offset lists       A Query Loop with an offset (the News list skips the featured post) counts
 *                    its pages without the skipped posts, so "Older posts" never leads to an
 *                    empty page.
 *
 * WordPress's untouched default category (slug "uncategorized") is left out of both.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Whether a term is WordPress's untouched default category.
 *
 * @param WP_Term $term Term.
 * @return bool
 */
function lilahcraft_is_uncategorized( $term ) {
	return 'uncategorized' === $term->slug;
}

/**
 * The topics to list: categories with published posts, most posts first, then by name.
 *
 * @return WP_Term[]
 */
function lilahcraft_news_topics() {
	$terms = get_terms(
		array(
			'taxonomy'     => 'category',
			'hide_empty'   => true,
			'hierarchical' => false,
		)
	);
	if ( is_wp_error( $terms ) || empty( $terms ) ) {
		return array();
	}
	$terms = array_values(
		array_filter(
			$terms,
			function ( $term ) {
				return $term->count > 0 && ! lilahcraft_is_uncategorized( $term );
			}
		)
	);
	usort(
		$terms,
		function ( $a, $b ) {
			if ( $a->count !== $b->count ) {
				return $b->count - $a->count;
			}
			return strnatcasecmp( $a->name, $b->name );
		}
	);
	return $terms;
}

/**
 * Render the Topics card.
 *
 * @return string
 */
function lilahcraft_render_topics() {
	static $n = 0;

	$terms = lilahcraft_news_topics();
	if ( ! $terms ) {
		return '';
	}

	++$n;
	$heading = 'lc-topics-' . $n;
	$current = is_category() ? (int) get_queried_object_id() : 0;

	$rows = '';
	foreach ( $terms as $term ) {
		$link = get_term_link( $term );
		if ( is_wp_error( $link ) ) {
			continue;
		}
		$count = (int) $term->count;
		$num   = number_format_i18n( $count );
		/* translators: 1: topic (category) name, 2: number of posts. Read by screen readers, e.g. "Updates, 2 posts". */
		$label = sprintf( _n( '%1$s, %2$s post', '%1$s, %2$s posts', $count, 'lilahcraft' ), $term->name, $num );
		$rows .= sprintf(
			'<li><a class="lc-topic" href="%1$s" aria-label="%2$s"%3$s><span class="lc-topic-name">%4$s</span><span class="lc-topic-n">%5$s</span></a></li>',
			esc_url( $link ),
			esc_attr( $label ),
			$current === (int) $term->term_id ? ' aria-current="page"' : '',
			esc_html( $term->name ),
			esc_html( $num )
		);
	}
	if ( '' === $rows ) {
		return '';
	}

	return sprintf(
		'<div class="lc-card lc-card--sm lc-topics"><h2 class="lc-topics-title" id="%1$s">%2$s</h2><ul class="lc-topics-list" aria-labelledby="%1$s">%3$s</ul></div>',
		esc_attr( $heading ),
		esc_html__( 'Topics', 'lilahcraft' ),
		$rows // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- built from escaped parts above.
	);
}

lilahcraft_register_block( 'lilahcraft/topics', __( 'News topics', 'lilahcraft' ), 'lilahcraft_render_topics', __( 'The post categories that have posts, with their post counts. Hidden when there are none.', 'lilahcraft' ) );

/*
 * Post meta: a Post Terms block with the class lc-news-topic shows the first category as text.
 */
add_filter(
	'render_block_core/post-terms',
	function ( $content, $block, $instance ) {
		$class = isset( $block['attrs']['className'] ) ? ' ' . $block['attrs']['className'] . ' ' : '';
		if ( false === strpos( $class, ' lc-news-topic ' ) || '' === $content ) {
			return $content;
		}
		$post_id = isset( $instance->context['postId'] ) ? (int) $instance->context['postId'] : get_the_ID();
		$terms   = $post_id ? get_the_terms( $post_id, 'category' ) : false;
		if ( ! $terms || is_wp_error( $terms ) ) {
			return '';
		}
		$terms = array_values(
			array_filter(
				$terms,
				function ( $term ) {
					return ! lilahcraft_is_uncategorized( $term );
				}
			)
		);
		if ( ! $terms || ! preg_match( '/^\s*(<div\b[^>]*>)/', $content, $open ) ) {
			return '';
		}
		$prefix = '';
		if ( ! empty( $block['attrs']['prefix'] ) ) {
			$prefix = '<span class="wp-block-post-terms__prefix">' . wp_kses_post( $block['attrs']['prefix'] ) . '</span>';
		}
		return $open[1] . $prefix . esc_html( $terms[0]->name ) . '</div>';
	},
	10,
	3
);

/*
 * Offset lists: remember a custom Query Loop's offset so its page count can leave those posts out.
 */
add_filter(
	'query_loop_block_query_vars',
	function ( $query, $block ) {
		$ctx = isset( $block->context['query'] ) ? $block->context['query'] : array();
		if ( empty( $ctx['inherit'] ) && ! empty( $ctx['offset'] ) && is_numeric( $ctx['offset'] ) ) {
			$query['lilahcraft_skip'] = absint( $ctx['offset'] );
		}
		return $query;
	},
	10,
	2
);

add_filter(
	'found_posts',
	function ( $found, $query ) {
		$skip = (int) $query->get( 'lilahcraft_skip' );
		return $skip ? max( 0, (int) $found - $skip ) : $found;
	},
	10,
	2
);
