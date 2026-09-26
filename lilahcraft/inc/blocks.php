<?php
/**
 * Theme blocks rendered in PHP.
 *
 * Each file in inc/blocks/ registers its blocks with lilahcraft_register_block(). They render on
 * the server (live settings, current page, real permalinks) and preview in the Site Editor
 * through assets/js/blocks-editor.js, which needs no build step.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register a server-rendered theme block.
 *
 * @param string   $name   Block name, lilahcraft/something.
 * @param string   $title  Title in the inserter.
 * @param callable $render Returns the block's HTML.
 * @param string   $desc   Short description.
 */
function lilahcraft_register_block( $name, $title, $render, $desc = '' ) {
	register_block_type(
		$name,
		array(
			'api_version'           => 3,
			'title'                 => $title,
			'description'           => $desc,
			'category'              => 'theme',
			'render_callback'       => $render,
			'editor_script_handles' => array( 'lilahcraft-blocks' ),
			'supports'              => array(
				'html'     => false,
				'multiple' => true,
			),
		)
	);
	$GLOBALS['lilahcraft_blocks'][] = array(
		'name'  => $name,
		'title' => $title,
	);
}

add_action(
	'init',
	function () {
		$GLOBALS['lilahcraft_blocks'] = array();
		wp_register_script(
			'lilahcraft-blocks',
			get_theme_file_uri( 'assets/js/blocks-editor.js' ),
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-server-side-render' ),
			lilahcraft_version(),
			true
		);
		foreach ( glob( get_template_directory() . '/inc/blocks/*.php' ) as $file ) {
			require_once $file;
		}
		wp_add_inline_script( 'lilahcraft-blocks', 'window.LC_BLOCKS=' . wp_json_encode( $GLOBALS['lilahcraft_blocks'] ) . ';', 'before' );
	}
);
