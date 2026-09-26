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

$files = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $root, FilesystemIterator::SKIP_DOTS ) );
foreach ( $files as $file ) {
	$path = str_replace( '\\', '/', $file->getPathname() );
	$rel  = substr( $path, strlen( $root ) - strlen( 'lilahcraft' ) );
	$body = file_get_contents( $path );

	if ( false !== stripos( $body, $private ) || false !== stripos( $path, $private ) ) {
		$failures[] = "$rel mentions the private server.";
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
