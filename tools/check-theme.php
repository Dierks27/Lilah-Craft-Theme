<?php
/**
 * Checks the theme folder before a release. Run: php tools/check-theme.php
 *
 * - every PHP file lints
 * - theme.json is valid JSON
 * - style.css has a Version
 * - nothing mentions the private server (the word is assembled below so this file passes too)
 * - no square brackets in the visible text of any template, part or pattern
 *   (placeholders like [n] must never ship; values hide instead)
 * - none of the old 2.0 look in any css, html, js, php, json or svg file: its colours (#1d2150, #ff7ac0,
 *   #63e3ea, and the navy #2b3172, #3d4494), its token and class names, rounded corners, outlined
 *   (text-stroke) text and the radial-gradient star field
 *
 * Exits 1 on any failure.
 */

$root     = dirname( __DIR__ ) . '/lilahcraft';
$failures = array();
$private  = 'home' . 'stead';
$can_lint = function_exists( 'exec' ) && PHP_BINARY && is_executable( PHP_BINARY );
if ( ! $can_lint ) {
	echo "Note: no PHP binary to lint with here, so the lint step is skipped.\n";
}

// 2.1 replaced the navy/pink/cyan look: none of it may come back. Pattern => what it is.
$old_look = array(
	'/#(1d2150|ff7ac0|63e3ea|2b3172|3d4494)\b/i' => 'an old 2.0 colour',
	'/(?<![\w-])--(night2?|deep|panel|rule-dark|row-dark|edge-dark|cyan(-shade)?|pink-shade|lilac|head-ink|line-soft|chip-line|dash|on-night(-soft|-bright)?|link(-hover)?|kicker|code|soft|raised|radius)(?![\w-])/' => 'an old 2.0 token',
	'/\b(lc-sec--lilac|lc-sec--night|lc-card--night|lc-btn--cyan|lc-btn--night|lc-pill--night|lc-pagehead)\b/' => 'an old 2.0 class',
	'/border-radius\s*:(?!\s*(0(px|em|rem|%)?\s*)+(!important\s*)?([;}"\'\n]|$)|\s*(inherit|initial|unset))\s*[^;}"\'\n]*/i' => 'rounded corners (square corners only)',
	'/text-stroke/i' => 'outlined text',
	'/radial-gradient/i' => 'a radial gradient (the old star field)',
);

$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS ) );
foreach ( $files as $file ) {
	$path = str_replace( '\\', '/', $file->getPathname() );
	$rel  = substr( $path, strlen( $root ) - strlen( 'lilahcraft' ) );
	$body = file_get_contents( $path );

	if ( false !== stripos( $body, $private ) || false !== stripos( $path, $private ) ) {
		$failures[] = "$rel mentions the private server.";
	}

	if ( preg_match( '/\.(css|html|js|php|json|svg)$/', $path ) ) {
		foreach ( $old_look as $pattern => $what ) {
			if ( preg_match( $pattern, $body, $old ) ) {
				$failures[] = "$rel still has $what ($old[0]).";
			}
		}
	}

	if ( $can_lint && substr( $path, -4 ) === '.php' ) {
		$out  = array();
		$code = 0;
		exec( escapeshellarg( PHP_BINARY ) . ' -l ' . escapeshellarg( $path ) . ' 2>&1', $out, $code );
		if ( 0 !== $code ) {
			$failures[] = "$rel does not lint: " . implode( ' ', $out );
		}
	}

	if ( preg_match( '#/(templates|parts|patterns)/#', $path ) ) {
		$text = preg_replace( '#<!--.*?-->#s', ' ', $body );
		$text = preg_replace( '#<\?php.*?\?>#s', ' ', $text );
		$text = preg_replace( '#<(script|style)\b.*?</\1>#si', ' ', $text );
		$text = html_entity_decode( strip_tags( $text ), ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		if ( preg_match_all( '#.{0,30}[\[\]].{0,30}#u', $text, $m ) ) {
			foreach ( $m[0] as $hit ) {
				$failures[] = "$rel shows a bracket: " . trim( preg_replace( '/\s+/', ' ', $hit ) );
			}
		}
	}
}

if ( null === json_decode( (string) file_get_contents( "$root/theme.json" ) ) ) {
	$failures[] = 'theme.json is not valid JSON.';
}
if ( ! preg_match( '/^Version:\s*(\S+)/m', (string) file_get_contents( "$root/style.css" ), $v ) ) {
	$failures[] = 'style.css has no Version line.';
}

if ( $failures ) {
	fwrite( STDERR, implode( "\n", $failures ) . "\n" );
	exit( 1 );
}
echo 'Theme checks passed' . ( isset( $v[1] ) ? ' (Version ' . $v[1] . ')' : '' ) . ".\n";
