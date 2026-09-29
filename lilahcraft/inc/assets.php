<?php
/**
 * Styles and scripts.
 *
 * Every page gets assets/css/site.css and assets/js/site.js. A page also gets
 * assets/css/page-{key}.css and assets/js/page-{key}.js when those files exist, where
 * {key} comes from lilahcraft_page_key(). Home, Market and Minis also get assets/js/lc-data.js.
 * URLs carry ?ver= with the theme Version, so bump it on every release.
 * The dark look: a script in <head> picks light or dark before the page paints, and each stylesheet's dark rules
 * are printed again after it for visitors without JavaScript (lilahcraft_dark_twin_css()).
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Which page of the site this request is: home, play, downloads, market, minis, arcade,
 * guide, news, or '' for anything else. Posts and archives count as news; search results
 * (templates/search.html, which can list pages too) are ''.
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
	if ( is_home() || is_singular( 'post' ) || is_archive() ) {
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
 * The Pixel pop fonts, served from the theme (assets/fonts, OFL): Unbounded (headings), Figtree (body),
 * JetBrains Mono (prices, addresses, kickers) and Silkscreen (the big background word only).
 * No request goes to Google.
 *
 * @return string
 */
function lilahcraft_fonts_url() {
	return get_theme_file_uri( 'assets/css/fonts.css' );
}

add_action(
	'wp_enqueue_scripts',
	function () {
		$v   = lilahcraft_version();
		$key = lilahcraft_page_key();

		wp_enqueue_style( 'lilahcraft-fonts', lilahcraft_fonts_url(), array(), $v );
		wp_enqueue_style( 'lilahcraft', get_theme_file_uri( 'assets/css/site.css' ), array( 'lilahcraft-fonts' ), $v );
		lilahcraft_add_dark_twin( 'lilahcraft', 'assets/css/site.css' );

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
			lilahcraft_add_dark_twin( "lilahcraft-$key", "assets/css/page-$key.css" );
		}
		if ( $key && file_exists( get_theme_file_path( "assets/js/page-$key.js" ) ) ) {
			wp_enqueue_script( "lilahcraft-$key", get_theme_file_uri( "assets/js/page-$key.js" ), $deps, $v, true );
		}
	},
	20
);

// Before the page paints: mark it as scripted, so the menu and live widgets never flash, and pick the light or
// dark look (<html data-theme>): the visitor's choice from the header switch (localStorage lc-theme, see site.js),
// else the device's. While nothing is stored it follows the device when that changes.
// Printed through WordPress with an id, so a security plugin's Content Security Policy can add its nonce.
add_action(
	'wp_head',
	function () {
		$js = "(function(d){d.className+=' lc-js';var m=window.matchMedia&&matchMedia('(prefers-color-scheme: dark)');"
			. "function pick(){var s=null;try{s=localStorage.getItem('lc-theme')}catch(e){}"
			. "d.setAttribute('data-theme',s==='dark'||s==='light'?s:(m&&m.matches?'dark':'light'))}"
			. "pick();if(m){if(m.addEventListener){m.addEventListener('change',pick)}else if(m.addListener){m.addListener(pick)}}"
			. '})(document.documentElement);';
		wp_print_inline_script_tag( $js, array( 'id' => 'lilahcraft-theme-js' ) );
	},
	1
);

/**
 * The dark look for visitors without JavaScript. site.css and the page files key every dark rule on
 * :root[data-theme="dark"], which only the script above sets. This returns those rules (and only those, in their
 * order, inside the same @media/@supports/@container blocks) rewritten for :root:not([data-theme]), wrapped in
 * @media (prefers-color-scheme:dark), so a device set to dark gets the same values. Printed on the front end only:
 * the block editor loads the stylesheets too, and its canvas stays light.
 *
 * @param string $css A stylesheet.
 * @return string '' when it has no dark rules.
 */
function lilahcraft_dark_twin_css( $css ) {
	if ( ! preg_match( '/:root\[data-theme=["\']?dark["\']?\]/', $css ) ) {
		return '';
	}
	$css   = preg_replace( '#/\*.*?\*/#s', '', $css );
	$parts = preg_split( '/([{}])/', $css, -1, PREG_SPLIT_DELIM_CAPTURE );
	$i     = 0;
	$out   = lilahcraft_dark_twin_block( $parts, $i );
	return '' !== $out ? '@media (prefers-color-scheme:dark){' . $out . '}' : '';
}

/**
 * One level of lilahcraft_dark_twin_css(): reads rules from $parts (text, '{', text, '}' …) starting at $i, up to
 * the '}' that closes the enclosing block (or the end), and returns the dark ones.
 *
 * @param string[] $parts The stylesheet split on braces.
 * @param int      $i     Where to start; left after the closing brace.
 * @return string
 */
function lilahcraft_dark_twin_block( $parts, &$i ) {
	$out = '';
	$n   = count( $parts );
	while ( $i < $n ) {
		if ( '}' === $parts[ $i ] ) {
			++$i;
			break;
		}
		if ( '{' === $parts[ $i ] || $i + 1 >= $n || '{' !== $parts[ $i + 1 ] ) {
			++$i; // Text with no block after it: whitespace, or a statement such as @import.
			continue;
		}
		// A prelude: keep what follows the last statement (e.g. "@import url(x); .a" is the rule ".a").
		$prelude = trim( (string) preg_replace( '/^.*;/s', '', $parts[ $i ] ) );
		$i      += 2;
		if ( preg_match( '/^@(media|supports|container)\b/i', $prelude ) ) {
			$inner = lilahcraft_dark_twin_block( $parts, $i );
			$out  .= '' !== $inner ? $prelude . '{' . $inner . '}' : '';
		} elseif ( '@' === substr( $prelude, 0, 1 ) ) {
			// Other at-rules (@font-face, @keyframes, @page): skip the whole block.
			for ( $depth = 1; $i < $n && $depth > 0; ++$i ) {
				$depth += '{' === $parts[ $i ] ? 1 : ( '}' === $parts[ $i ] ? -1 : 0 );
			}
		} else {
			$body = isset( $parts[ $i ] ) && '{' !== $parts[ $i ] && '}' !== $parts[ $i ] ? trim( $parts[ $i++ ] ) : '';
			if ( $i < $n && '}' === $parts[ $i ] ) {
				++$i;
			}
			$dark = array();
			foreach ( lilahcraft_split_selectors( $prelude ) as $selector ) {
				if ( preg_match( '/:root\[data-theme=["\']?dark["\']?\]/', $selector ) ) {
					$dark[] = preg_replace( '/:root\[data-theme=["\']?dark["\']?\]/', ':root:not([data-theme])', $selector );
				}
			}
			$out .= $dark && '' !== $body ? implode( ',', $dark ) . '{' . $body . '}' : '';
		}
	}
	return preg_replace( '/\s+/', ' ', $out );
}

/**
 * Print a stylesheet's dark rules for visitors without JavaScript right after it (lilahcraft_dark_twin_css()).
 *
 * @param string $handle The stylesheet's handle.
 * @param string $file   Its path in the theme.
 */
function lilahcraft_add_dark_twin( $handle, $file ) {
	$path = get_theme_file_path( $file );
	$css  = is_readable( $path ) ? lilahcraft_dark_twin_css( (string) file_get_contents( $path ) ) : '';
	if ( '' !== $css ) {
		// In the page itself, url(../img/…) would be read from the page's address: point it at the theme.
		$base = trailingslashit( dirname( get_theme_file_uri( $file ) ) );
		$css  = preg_replace_callback(
			'#url\(\s*([\'"]?)(?![a-z][a-z0-9+.-]*:|/|\#)#i',
			function ( $m ) use ( $base ) {
				return 'url(' . $m[1] . $base;
			},
			$css
		);
		wp_add_inline_style( $handle, $css );
	}
}

/**
 * A selector list split on its top-level commas (not the ones inside :is(), :not() and the like).
 *
 * @param string $list Selector list.
 * @return string[]
 */
function lilahcraft_split_selectors( $list ) {
	$out   = array();
	$depth = 0;
	$cur   = '';
	foreach ( str_split( $list ) as $ch ) {
		if ( '(' === $ch ) {
			++$depth;
		} elseif ( ')' === $ch ) {
			--$depth;
		} elseif ( ',' === $ch && 0 === $depth ) {
			$out[] = trim( $cur );
			$cur   = '';
			continue;
		}
		$cur .= $ch;
	}
	$out[] = trim( $cur );
	return array_filter( $out, 'strlen' );
}

// The two fonts every page needs first, fetched before the stylesheet asks for them.
add_action(
	'wp_head',
	function () {
		foreach ( array( 'figtree-400-800-latin.woff2', 'unbounded-var-latin.woff2' ) as $font ) {
			printf( '<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n", esc_url( get_theme_file_uri( 'assets/fonts/' . $font ) ) );
		}
	},
	2
);

// The tab icon: the logo's four squares, instead of WordPress's W. A Site Icon set in
// Settings > General (or the Site Editor) takes over, as WordPress prints that one itself.
add_action(
	'wp_head',
	function () {
		if ( has_site_icon() ) {
			return;
		}
		$dir = 'assets/img/icon/';
		printf( '<link rel="icon" href="%s" type="image/svg+xml">' . "\n", esc_url( get_theme_file_uri( $dir . 'icon.svg' ) ) );
		printf( '<link rel="icon" href="%s" sizes="32x32" type="image/png">' . "\n", esc_url( get_theme_file_uri( $dir . 'favicon-32.png' ) ) );
		printf( '<link rel="icon" href="%s" sizes="192x192" type="image/png">' . "\n", esc_url( get_theme_file_uri( $dir . 'icon-192.png' ) ) );
		printf( '<link rel="apple-touch-icon" href="%s">' . "\n", esc_url( get_theme_file_uri( $dir . 'apple-touch-icon.png' ) ) );
	},
	3
);

// Browsers and feed readers that ask for /favicon.ico get the same icon, not the W WordPress sends there.
add_action(
	'do_faviconico',
	function () {
		if ( ! has_site_icon() ) {
			wp_safe_redirect( get_theme_file_uri( 'assets/img/icon/favicon-32.png' ), 302, 'LilahCraft' );
			exit;
		}
	}
);

// The block editor shows the same fonts and styles, page files included.
add_action(
	'after_setup_theme',
	function () {
		$files = array( 'assets/css/fonts.css', 'assets/css/site.css' );
		foreach ( glob( get_theme_file_path( 'assets/css/page-*.css' ) ) as $file ) {
			$files[] = 'assets/css/' . basename( $file );
		}
		$files[] = 'assets/css/editor.css';
		add_editor_style( $files );
	}
);
