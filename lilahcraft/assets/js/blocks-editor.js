/* Editor previews for the theme's PHP-rendered blocks (inc/blocks/*.php). No build step. */
( function ( wp ) {
	if ( ! wp || ! wp.blocks || ! wp.serverSideRender ) {
		return;
	}
	var el = wp.element.createElement;
	( window.LC_BLOCKS || [] ).forEach( function ( b ) {
		var existing = wp.blocks.getBlockType( b.name );
		if ( existing && existing.edit ) {
			return;
		}
		wp.blocks.registerBlockType( b.name, {
			apiVersion: 3,
			title: b.title,
			category: 'theme',
			edit: function () {
				return el(
					'div',
					wp.blockEditor.useBlockProps(),
					el( wp.serverSideRender, { block: b.name } )
				);
			},
			save: function () {
				return null;
			},
		} );
	} );
} )( window.wp );
