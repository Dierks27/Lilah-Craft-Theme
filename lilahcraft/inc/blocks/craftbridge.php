<?php
/**
 * lilahcraft/craftbridge: the CraftBridge Client download card on the Downloads page.
 *
 * The loud white two-column board: what the mod does on the left, the picker on the right
 * (Minecraft 26.2 or 26.3, Fabric or NeoForge), the Download link for the pick, the file name
 * and what else the pick needs. The default pick is rendered here, so the link works without
 * JavaScript; assets/js/page-downloads.js switches picks from the data in data-lc-cb.
 *
 * Links come from Settings > LilahCraft: the download URL pattern with {version}, {mc} and
 * {loader} filled in. Each link is checked with a HEAD request (cached 12 hours in the
 * lilahcraft_cb_assets transient, which saving the settings clears). A file that answers
 * 404 or 410 links to its GitHub release page instead. A network error keeps the file link.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * What each pick needs besides the mod, from the CraftBridge-Client README (0.4.0).
 * Keys are the Minecraft versions the picker offers, in order.
 *
 * @return array
 */
function lilahcraft_cb_requirements() {
	return array(
		'26.2' => array(
			'fabric'   => 'Fabric Loader 0.19.5+ and Fabric API 0.160.0+26.2',
			'neoforge' => 'NeoForge 26.2.0.82 or newer',
			'jei'      => 'JEI 30.32.0.209',
		),
		'26.3' => array(
			'fabric'   => 'Fabric Loader 0.19.5+ and Fabric API 0.161.0+26.3',
			'neoforge' => 'NeoForge 26.3.0.16-beta or newer',
			'jei'      => 'JEI 31.7.0.34',
		),
	);
}

/**
 * Mod loaders, URL value => label.
 *
 * @return array
 */
function lilahcraft_cb_loaders() {
	return array(
		'fabric'   => 'Fabric',
		'neoforge' => 'NeoForge',
	);
}

/**
 * The GitHub release page for a GitHub release asset URL, or '' for any other URL.
 *
 * @param string $url Asset URL, like https://github.com/o/r/releases/download/v1/file.jar.
 * @return string
 */
function lilahcraft_cb_release_page( $url ) {
	if ( preg_match( '#^https?://(?:www\.)?github\.com/([^/?\#]+)/([^/?\#]+)/releases/download/([^/?\#]+)/[^/?\#]+$#i', (string) $url, $m ) ) {
		return 'https://github.com/' . $m[1] . '/' . $m[2] . '/releases/tag/' . $m[3];
	}
	return '';
}

/**
 * Whether each URL is there: 'ok', 'missing' (404 or 410) or 'unknown' (network error,
 * timeout, server error). Results are cached per URL in the lilahcraft_cb_assets transient:
 * 12 hours for an answer, 15 minutes for unknown, so a changed pattern or version re-checks.
 *
 * @param string[] $urls URLs to check.
 * @return array URL => state.
 */
function lilahcraft_cb_check_assets( $urls ) {
	$urls  = array_values( array_unique( array_filter( array_map( 'strval', (array) $urls ) ) ) );
	$now   = time();
	$cache = get_transient( 'lilahcraft_cb_assets' );
	$cache = is_array( $cache ) ? $cache : array();
	$out   = array();
	$todo  = array();

	foreach ( $urls as $url ) {
		$hit = ( isset( $cache[ $url ] ) && is_array( $cache[ $url ] ) && isset( $cache[ $url ]['s'], $cache[ $url ]['t'] ) ) ? $cache[ $url ] : null;
		$ttl = ( $hit && 'unknown' === $hit['s'] ) ? 15 * MINUTE_IN_SECONDS : 12 * HOUR_IN_SECONDS;
		if ( $hit && ( $now - (int) $hit['t'] ) < $ttl ) {
			$out[ $url ] = (string) $hit['s'];
		} else {
			$todo[] = $url;
		}
	}
	if ( ! $todo ) {
		return $out;
	}

	$fresh   = array();
	$offline = false;
	foreach ( $todo as $url ) {
		$state = 'unknown';
		// After one network error the rest would fail the same way, so don't make the page wait.
		if ( ! $offline ) {
			$res = wp_remote_head(
				$url,
				array(
					'timeout'     => 3,
					'redirection' => 3,
				)
			);
			if ( is_wp_error( $res ) ) {
				$offline = true;
			} else {
				$code = (int) wp_remote_retrieve_response_code( $res );
				if ( 404 === $code || 410 === $code ) {
					$state = 'missing';
				} elseif ( $code >= 200 && $code < 500 && 429 !== $code ) {
					$state = 'ok';
				}
			}
		}
		$out[ $url ]   = $state;
		$fresh[ $url ] = array(
			's' => $state,
			't' => $now,
		);
	}

	// Keep only the URLs in use now, so old patterns and versions drop out.
	$keep = array();
	foreach ( $urls as $url ) {
		if ( isset( $fresh[ $url ] ) ) {
			$keep[ $url ] = $fresh[ $url ];
		} elseif ( isset( $cache[ $url ] ) ) {
			$keep[ $url ] = $cache[ $url ];
		}
	}
	set_transient( 'lilahcraft_cb_assets', $keep, 12 * HOUR_IN_SECONDS );

	return $out;
}

/**
 * Everything the card shows for each pick.
 *
 * @return array {
 *     @type string $version CraftBridge Client version.
 *     @type array  $picks   [mc][loader] => { href, file, label, line, needs[], fallback }.
 * }
 */
function lilahcraft_cb_data() {
	$defaults = lilahcraft_defaults();
	$version  = trim( (string) lilahcraft_setting( 'cb_version' ) );
	$version  = '' !== $version ? $version : $defaults['cb_version'];
	$pattern  = trim( (string) lilahcraft_setting( 'cb_url' ) );
	$pattern  = '' !== $pattern ? $pattern : $defaults['cb_url'];
	$reqs     = lilahcraft_cb_requirements();
	$loaders  = lilahcraft_cb_loaders();

	$urls = array();
	foreach ( $reqs as $mc => $req ) {
		foreach ( $loaders as $loader => $label ) {
			$urls[ $mc ][ $loader ] = str_replace( array( '{version}', '{mc}', '{loader}' ), array( rawurlencode( $version ), $mc, $loader ), $pattern );
		}
	}

	$flat = array();
	foreach ( $urls as $by_loader ) {
		foreach ( $by_loader as $url ) {
			$flat[] = $url;
		}
	}
	$states = lilahcraft_cb_check_assets( $flat );

	$picks = array();
	foreach ( $urls as $mc => $by_loader ) {
		foreach ( $by_loader as $loader => $url ) {
			$path = (string) wp_parse_url( $url, PHP_URL_PATH );
			$file = '' !== $path ? rawurldecode( wp_basename( $path ) ) : '';
			if ( '' === $file ) {
				$file = 'craftbridge-client-' . $mc . '-' . $loader . '-' . $version . '.jar';
			}
			$release  = lilahcraft_cb_release_page( $url );
			$fallback = isset( $states[ $url ] ) && 'missing' === $states[ $url ] && '' !== $release;

			$picks[ $mc ][ $loader ] = array(
				'href'     => esc_url_raw( $fallback ? $release : $url ),
				'file'     => $file,
				'label'    => $fallback ? __( 'Open the release page', 'lilahcraft' ) : __( 'Download', 'lilahcraft' ),
				'line'     => $fallback ? __( 'No file for this pick yet, so this opens the release page.', 'lilahcraft' ) : $file,
				'needs'    => array(
					$reqs[ $mc ][ $loader ],
					/* translators: %s: JEI version, like JEI 30.32.0.209. */
					sprintf( __( '%s for the same loader', 'lilahcraft' ), $reqs[ $mc ]['jei'] ),
				),
				'fallback' => $fallback,
			);
		}
	}

	return array(
		'version' => $version,
		'picks'   => $picks,
	);
}

/**
 * The two icons on the download button: an arrow into a tray, or an arrow out to a page.
 *
 * @param bool $fallback Whether the link opens the release page.
 * @return string
 */
function lilahcraft_cb_icons( $fallback ) {
	return '<svg class="lc-cb-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-lc-cb-icon="file"' . ( $fallback ? ' hidden' : '' ) . '><path d="M12 4v11M7 10l5 5 5-5M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
		. '<svg class="lc-cb-icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-lc-cb-icon="page"' . ( $fallback ? '' : ' hidden' ) . '><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

/**
 * Render the card and the line under it.
 *
 * @return string
 */
function lilahcraft_render_craftbridge() {
	static $count = 0;
	++$count;
	$id = 'lc-cb-' . $count;

	$data    = lilahcraft_cb_data();
	$reqs    = lilahcraft_cb_requirements();
	$loaders = lilahcraft_cb_loaders();

	// Start on the server's Minecraft version when the picker offers it, with Fabric.
	$server = trim( (string) lilahcraft_setting( 'mc_version' ) );
	$mcs    = array_keys( $reqs );
	$mc     = isset( $data['picks'][ $server ] ) ? $server : $mcs[0];
	$loader = 'fabric';
	$pick   = $data['picks'][ $mc ][ $loader ];

	$json = wp_json_encode( $data['picks'], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT );

	// The Site Editor preview comes over REST and runs no page scripts; it still shows the picker.
	$preview = defined( 'REST_REQUEST' ) && REST_REQUEST;

	$features = array(
		esc_html__( 'Shows everything in your nearby chests beside the Linked Workbench and the Combo Chest, not just the first 36 kinds of item.', 'lilahcraft' ),
		esc_html__( 'Click to take: left-click for a stack, right-click for half, shift-click for as many as fit.', 'lilahcraft' ),
		/* translators: %s: JEI's plus button, drawn as a key. */
		sprintf( esc_html__( 'Pick how many to craft with JEI’s %s, including All but one.', 'lilahcraft' ), '<kbd>+</kbd>' ),
		esc_html__( 'Middle-click a chest or your inventory to sort it.', 'lilahcraft' ),
	);

	ob_start();
	?>
<div class="lc-cb">
	<div class="lc-board lc-cb-board">
		<div class="lc-cb-about">
			<div class="lc-cb-head">
				<h3 class="lc-cb-title"><?php esc_html_e( 'CraftBridge Client', 'lilahcraft' ); ?></h3>
				<span class="lc-pill lc-pill--code"><span class="lc-sr"><?php esc_html_e( 'Version', 'lilahcraft' ); ?> </span><?php echo esc_html( $data['version'] ); ?></span>
			</div>
			<p class="lc-cb-lede"><?php esc_html_e( 'Our own client mod. It makes the server’s crafting and storage blocks see everything you own.', 'lilahcraft' ); ?></p>
			<ul class="lc-cb-feats">
				<?php foreach ( $features as $feature ) : ?>
				<li><?php echo $feature; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above. ?></li>
				<?php endforeach; ?>
			</ul>
			<p class="lc-cb-quiet"><?php esc_html_e( 'It does nothing on other servers, and it has no settings to fiddle with.', 'lilahcraft' ); ?></p>
		</div>
		<div class="lc-cb-get<?php echo $preview ? ' lc-cb-get--preview' : ''; ?>" data-lc-cb="<?php echo esc_attr( $json ); ?>">
			<div class="lc-cb-group">
				<span class="lc-cb-label" id="<?php echo esc_attr( $id ); ?>-mc"><?php esc_html_e( 'Minecraft version', 'lilahcraft' ); ?></span>
				<div class="lc-cb-opts" role="group" aria-labelledby="<?php echo esc_attr( $id ); ?>-mc">
					<?php foreach ( $mcs as $value ) : ?>
					<button class="lc-chip lc-cb-opt lc-cb-opt--mono" type="button" aria-pressed="<?php echo $value === $mc ? 'true' : 'false'; ?>" data-lc-cb-mc="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $value ); ?></button>
					<?php endforeach; ?>
				</div>
			</div>
			<div class="lc-cb-group">
				<span class="lc-cb-label" id="<?php echo esc_attr( $id ); ?>-loader"><?php esc_html_e( 'Mod loader', 'lilahcraft' ); ?></span>
				<div class="lc-cb-opts" role="group" aria-labelledby="<?php echo esc_attr( $id ); ?>-loader">
					<?php foreach ( $loaders as $value => $label ) : ?>
					<button class="lc-chip lc-cb-opt" type="button" aria-pressed="<?php echo $value === $loader ? 'true' : 'false'; ?>" data-lc-cb-loader="<?php echo esc_attr( $value ); ?>"><?php echo esc_html( $label ); ?></button>
					<?php endforeach; ?>
				</div>
			</div>
			<a class="lc-btn lc-btn--orange lc-cb-dl" href="<?php echo esc_url( $pick['href'] ); ?>" aria-describedby="<?php echo esc_attr( $id ); ?>-file" data-lc-cb-link><?php echo lilahcraft_cb_icons( $pick['fallback'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup. ?><span data-lc-cb-label><?php echo esc_html( $pick['label'] ); ?></span><span class="lc-sr"> <?php esc_html_e( 'CraftBridge Client', 'lilahcraft' ); ?></span></a>
			<p class="lc-cb-file<?php echo $pick['fallback'] ? ' is-note' : ''; ?>" id="<?php echo esc_attr( $id ); ?>-file" data-lc-cb-file><?php echo esc_html( $pick['line'] ); ?></p>
			<div class="lc-cb-needs">
				<p class="lc-cb-label" id="<?php echo esc_attr( $id ); ?>-needs"><?php esc_html_e( 'You also need', 'lilahcraft' ); ?></p>
				<ul class="lc-cb-list" aria-labelledby="<?php echo esc_attr( $id ); ?>-needs" data-lc-cb-needs>
					<?php foreach ( $pick['needs'] as $need ) : ?>
					<li><?php echo esc_html( $need ); ?></li>
					<?php endforeach; ?>
				</ul>
				<p class="lc-cb-need"><?php esc_html_e( 'Client only. Don’t put it on a server.', 'lilahcraft' ); ?></p>
			</div>
			<noscript>
				<div class="lc-cb-all">
					<p class="lc-cb-label"><?php esc_html_e( 'Every download', 'lilahcraft' ); ?></p>
					<ul class="lc-cb-list">
						<?php foreach ( $data['picks'] as $pick_mc => $by_loader ) : ?>
							<?php foreach ( $by_loader as $pick_loader => $one ) : ?>
						<li>
							<a href="<?php echo esc_url( $one['href'] ); ?>">
								<?php
								echo esc_html(
									sprintf(
										/* translators: 1: Minecraft version, 2: mod loader. */
										__( 'Minecraft %1$s, %2$s', 'lilahcraft' ),
										$pick_mc,
										$loaders[ $pick_loader ]
									)
								);
								?>
							</a>
							<span class="lc-cb-all-file"><?php echo esc_html( $one['line'] ); ?></span>
							<span class="lc-cb-all-needs"><?php echo esc_html( implode( '. ', $one['needs'] ) . '.' ); ?></span>
						</li>
							<?php endforeach; ?>
						<?php endforeach; ?>
					</ul>
				</div>
			</noscript>
		</div>
	</div>
	<?php if ( '' !== $server ) : ?>
	<p class="lc-note lc-cb-server">
		<?php
		/* translators: %s: the server's Minecraft version, like 26.2. */
		echo esc_html( sprintf( __( 'Pick the Minecraft version the server is on right now: %s.', 'lilahcraft' ), $server ) );
		?>
	</p>
	<?php endif; ?>
</div>
	<?php
	return trim( ob_get_clean() );
}

lilahcraft_register_block( 'lilahcraft/craftbridge', __( 'CraftBridge Client download', 'lilahcraft' ), 'lilahcraft_render_craftbridge', __( 'The CraftBridge Client card: pick a Minecraft version and loader, get the matching jar and what it needs.', 'lilahcraft' ) );
