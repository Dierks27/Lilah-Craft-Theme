<?php
/**
 * Theme updates from GitHub releases.
 *
 * style.css has "Update URI: https://github.com/Dierks27/Lilah-Craft-Theme", so WordPress leaves this theme
 * out of its wordpress.org check and asks the update_themes_github.com filter instead (WordPress 6.1+).
 * We answer with the newest release that has lilahcraft-theme-<version>.zip attached. WordPress then offers it
 * under Dashboard > Updates like any other theme update, and installs it by itself when auto-updates are on
 * (switched on once by default; Appearance > Themes > LilahCraft turns them off).
 *
 * The release zip unpacks to lilahcraft/, which replaces this theme in place. Publishing a release on the
 * repo therefore ships it to the site: treat release access like site access.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The GitHub repository releases come from.
 *
 * @return string owner/name
 */
function lilahcraft_update_repo() {
	return 'Dierks27/Lilah-Craft-Theme';
}

/**
 * The newest usable release: { version, url, package }, or null. Cached for an hour
 * (GitHub allows 60 unauthenticated requests an hour per server); "Check again" on
 * Dashboard > Updates skips the cache.
 *
 * @return array|null
 */
function lilahcraft_latest_release() {
	$force  = is_admin() && isset( $_GET['force-check'] ); // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only: only skips our cache.
	$cached = $force ? false : get_site_transient( 'lilahcraft_latest_release' );
	if ( is_array( $cached ) ) {
		return empty( $cached['version'] ) ? null : $cached;
	}

	$found = array();
	$res   = wp_remote_get(
		'https://api.github.com/repos/' . lilahcraft_update_repo() . '/releases/latest',
		array(
			'timeout' => 8,
			'headers' => array(
				'Accept'               => 'application/vnd.github+json',
				'X-GitHub-Api-Version' => '2022-11-28',
			),
		)
	);
	if ( ! is_wp_error( $res ) && 200 === (int) wp_remote_retrieve_response_code( $res ) ) {
		$rel = json_decode( wp_remote_retrieve_body( $res ), true );
		$tag = is_array( $rel ) && isset( $rel['tag_name'] ) ? ltrim( (string) $rel['tag_name'], 'vV' ) : '';
		if ( preg_match( '/^\d+(\.\d+){1,3}$/', $tag ) && empty( $rel['draft'] ) && empty( $rel['prerelease'] ) && ! empty( $rel['assets'] ) ) {
			foreach ( (array) $rel['assets'] as $asset ) {
				$name = isset( $asset['name'] ) ? (string) $asset['name'] : '';
				$url  = isset( $asset['browser_download_url'] ) ? (string) $asset['browser_download_url'] : '';
				if ( 'lilahcraft-theme-' . $tag . '.zip' === $name && 0 === strpos( $url, 'https://github.com/' . lilahcraft_update_repo() . '/releases/download/' ) ) {
					$found = array(
						'version' => $tag,
						'url'     => isset( $rel['html_url'] ) ? esc_url_raw( $rel['html_url'] ) : 'https://github.com/' . lilahcraft_update_repo() . '/releases',
						'package' => esc_url_raw( $url ),
					);
					break;
				}
			}
		}
	}

	// Cache misses and failures too, so a GitHub hiccup doesn't cost a request on every admin page.
	set_site_transient( 'lilahcraft_latest_release', $found, HOUR_IN_SECONDS );
	return $found ? $found : null;
}

add_filter(
	'update_themes_github.com',
	function ( $update, $theme_data, $stylesheet ) {
		if ( get_template() !== $stylesheet || false === stripos( (string) ( isset( $theme_data['UpdateURI'] ) ? $theme_data['UpdateURI'] : '' ), lilahcraft_update_repo() ) ) {
			return $update;
		}
		$rel = lilahcraft_latest_release();
		if ( ! $rel ) {
			return $update;
		}
		$theme = wp_get_theme( $stylesheet );
		return array(
			'theme'        => $stylesheet, // The background auto-updater installs by this key.
			'version'      => $rel['version'],
			'url'          => $rel['url'],
			'package'      => $rel['package'],
			'requires'     => (string) $theme->get( 'RequiresWP' ),
			'requires_php' => (string) $theme->get( 'RequiresPHP' ),
		);
	},
	10,
	3
);

// The release zip holds lilahcraft/. If a zip ever unpacks to another folder name, rename it so the
// update replaces this theme instead of installing a second copy beside it.
add_filter(
	'upgrader_source_selection',
	function ( $source, $remote_source, $upgrader, $hook_extra = array() ) {
		global $wp_filesystem;
		$theme = isset( $hook_extra['theme'] ) ? $hook_extra['theme'] : '';
		if ( get_template() !== $theme || ! $wp_filesystem || untrailingslashit( basename( $source ) ) === $theme ) {
			return $source;
		}
		$target = trailingslashit( $remote_source ) . $theme . '/';
		return $wp_filesystem->move( $source, $target, true ) ? $target : $source;
	},
	10,
	4
);

// Switch auto-updates on for this theme once, the way the "Enable auto-updates" link would.
// If Jeff turns them off later, this never turns them back on.
add_action(
	'admin_init',
	function () {
		if ( get_option( 'lilahcraft_autoupdate_default' ) || ! current_user_can( 'update_themes' ) ) {
			return;
		}
		$auto = (array) get_site_option( 'auto_update_themes', array() );
		if ( ! in_array( get_template(), $auto, true ) ) {
			$auto[] = get_template();
			update_site_option( 'auto_update_themes', $auto );
		}
		update_option( 'lilahcraft_autoupdate_default', 1, false );
	}
);
