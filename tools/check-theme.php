<?php
/**
 * Checks the theme folder before a release. Run: php tools/check-theme.php
 *
 * - every PHP file lints (when there is a PHP binary to lint with)
 * - every JavaScript file parses (when node is installed)
 * - theme.json is valid JSON
 * - style.css has a Version
 * - nothing mentions the private server (the word is assembled below so this file passes too)
 * - no square brackets in the visible text of any template, part or pattern
 *   (placeholders like [n] must never ship; values hide instead)
 * - the visible text of templates, parts and patterns says LilahCraft, never the plugin's name for the server
 *   ("HomeCraft"; the plugin's own name, HomeCraftMgmt, is let through)
 * - none of the old 2.0 look in any css, html, js, php, json or svg file: its colours (#1d2150, #ff7ac0,
 *   #63e3ea, and the navy #2b3172, #3d4494), its token and class names, rounded corners, outlined
 *   (text-stroke) text and the radial-gradient star field
 * - the Arcade's files never use the words HomeCraftMgmt keeps out of anything about games of chance:
 *   bet, wager, gamble, casino, lucky, almost, so close (its tokens are "tokens in" and "tokens back").
 *   The Arcade's files are every file with "arcade" in its name, and the two data files that hold the Arcade's
 *   labels, sample data and cleaner: assets/js/lc-data.js and inc/feeds.php. Comments count too
 * - the Market's department table (inc/departments.php) only names the eight departments and whole material names
 * - the eight departments are the same list, in the same order, in inc/departments.php and assets/js/lc-data.js
 *   (the tabs a page shows when the feed doesn't send its own must be the ones PHP sorts the items into)
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
// node is only looked for where PHP can run a program at all (the same test as for the lint).
$node = '';
if ( $can_lint ) {
	$out  = array();
	$code = 1;
	exec( 'node --version 2>&1', $out, $code );
	$node = 0 === $code ? 'node' : '';
}
if ( '' === $node ) {
	echo "Note: no node to run here, so the JavaScript files are not parsed.\n";
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

// HomeCraftMgmt's word rule for games of chance (its games guide), checked in the Arcade's files. "Lucky
// Fishing" is a Prize Counter boost, not a game of chance.
$chance_words = '/\b(bets?|betting|wager\w*|gambl\w*|casinos?|lucky|almost|so\s+close)\b/i';

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

	$arcade_file = preg_match( '/\.(css|html|js|php)$/', $path )
		&& ( false !== stripos( basename( $path ), 'arcade' ) || preg_match( '#/(assets/js/lc-data\.js|inc/feeds\.php)$#', $path ) );
	if ( $arcade_file && preg_match_all( $chance_words, preg_replace( '/lucky fishing/i', '', $body ), $words ) ) {
		$failures[] = "$rel uses a word the Arcade never uses about games of chance: " . implode( ', ', array_unique( $words[0] ) ) . '.';
	}

	if ( $can_lint && substr( $path, -4 ) === '.php' ) {
		$out  = array();
		$code = 0;
		exec( escapeshellarg( PHP_BINARY ) . ' -l ' . escapeshellarg( $path ) . ' 2>&1', $out, $code );
		if ( 0 !== $code ) {
			$failures[] = "$rel does not lint: " . implode( ' ', $out );
		}
	}

	if ( '' !== $node && substr( $path, -3 ) === '.js' ) {
		$out  = array();
		$code = 0;
		exec( $node . ' --check ' . escapeshellarg( $path ) . ' 2>&1', $out, $code );
		if ( 0 !== $code ) {
			$failures[] = "$rel does not parse: " . implode( ' ', array_slice( $out, 0, 6 ) );
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
		// The plugin's write-ups call the server "HomeCraft". The site says LilahCraft. (The plugin's own name,
		// HomeCraftMgmt, is not the server's.)
		if ( preg_match( '#.{0,30}HomeCraft(?!Mgmt|Management).{0,20}#iu', $text, $m ) ) {
			$failures[] = "$rel shows the plugin's name for the server: " . trim( preg_replace( '/\s+/', ' ', $m[0] ) );
		}
	}
}

if ( null === json_decode( (string) file_get_contents( "$root/theme.json" ) ) ) {
	$failures[] = 'theme.json is not valid JSON.';
}
if ( ! preg_match( '/^Version:\s*(\S+)/m', (string) file_get_contents( "$root/style.css" ), $v ) ) {
	$failures[] = 'style.css has no Version line.';
}

// The department table: a slip in it (a department that isn't one of the eight, a broken material name) would
// quietly put items under the wrong tab.
if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', $root . '/' );
}
require "$root/inc/departments.php";
foreach ( lilahcraft_department_table() as $material => $department ) {
	if ( ! preg_match( '/^[A-Z][A-Z0-9_]*$/D', (string) $material ) || ! in_array( $department, lilahcraft_departments(), true ) ) {
		$failures[] = "inc/departments.php: \"$material\" => \"$department\" is not a material in one of the eight departments.";
	}
}
// lc-data.js keeps the same eight for a market answer without its own tabs (and for the sample). The two lists
// are written by hand, so check they are one list.
$js_tabs = preg_match( '/\bvar DEPARTMENTS = (\[[^\]]*\]);/', (string) file_get_contents( "$root/assets/js/lc-data.js" ), $m )
	? json_decode( str_replace( "'", '"', $m[1] ), true )
	: null;
if ( lilahcraft_departments() !== $js_tabs ) {
	$failures[] = 'assets/js/lc-data.js: DEPARTMENTS is not the list in inc/departments.php (lilahcraft_departments()), in its order.';
}

if ( $failures ) {
	fwrite( STDERR, implode( "\n", $failures ) . "\n" );
	exit( 1 );
}
echo 'Theme checks passed' . ( isset( $v[1] ) ? ' (Version ' . $v[1] . ')' : '' ) . ".\n";
