<?php
/**
 * Java Edition server list ping, done from PHP so browsers never touch the game server.
 *
 * Handshake (next state 1) + status request over TCP, 3 second budget, result cached 60 seconds.
 * The protocol is the one every Minecraft client uses for its server list.
 *
 * @package LilahCraft
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Cached server status for the header.
 *
 * @return array { online: bool, players?: int, max?: int, version?: string }
 */
function lilahcraft_server_status() {
	$cached = get_transient( 'lilahcraft_status' );
	if ( is_array( $cached ) ) {
		return $cached;
	}

	$host = (string) lilahcraft_setting( 'server_host' );
	$port = (int) lilahcraft_setting( 'server_port' );
	$ping = $host ? lilahcraft_ping( $host, $port ? $port : 25565, 3 ) : new WP_Error( 'lilahcraft_ping', 'No server address.' );

	if ( is_wp_error( $ping ) ) {
		$out = array( 'online' => false );
	} else {
		$out = array( 'online' => true ) + $ping;
	}
	set_transient( 'lilahcraft_status', $out, 60 );
	return $out;
}

/**
 * Encode a VarInt. Negative numbers are sent as their 32-bit two's complement.
 *
 * @param int $value Number.
 * @return string
 */
function lilahcraft_varint( $value ) {
	$value &= 0xFFFFFFFF;
	$out    = '';
	do {
		$byte    = $value & 0x7F;
		$value >>= 7;
		if ( $value ) {
			$byte |= 0x80;
		}
		$out .= chr( $byte );
	} while ( $value );
	return $out;
}

/**
 * Read exactly $len bytes before the deadline.
 *
 * @param resource $sock     Socket.
 * @param int      $len      Bytes wanted.
 * @param float    $deadline microtime( true ) limit.
 * @return string|false
 */
function lilahcraft_read_bytes( $sock, $len, $deadline ) {
	$buf = '';
	while ( strlen( $buf ) < $len ) {
		$left = $deadline - microtime( true );
		if ( $left <= 0 ) {
			return false;
		}
		stream_set_timeout( $sock, (int) floor( $left ), (int) ( ( $left - floor( $left ) ) * 1000000 ) );
		$chunk = fread( $sock, $len - strlen( $buf ) );
		if ( false === $chunk || '' === $chunk ) {
			$meta = stream_get_meta_data( $sock );
			if ( ! empty( $meta['timed_out'] ) || feof( $sock ) ) {
				return false;
			}
			continue;
		}
		$buf .= $chunk;
	}
	return $buf;
}

/**
 * Read a VarInt from the socket.
 *
 * @param resource $sock     Socket.
 * @param float    $deadline microtime( true ) limit.
 * @return int|false
 */
function lilahcraft_read_varint( $sock, $deadline ) {
	$value = 0;
	for ( $i = 0; $i < 5; $i++ ) {
		$byte = lilahcraft_read_bytes( $sock, 1, $deadline );
		if ( false === $byte ) {
			return false;
		}
		$b      = ord( $byte );
		$value |= ( $b & 0x7F ) << ( 7 * $i );
		if ( ! ( $b & 0x80 ) ) {
			return $value;
		}
	}
	return false;
}

/**
 * Pull a VarInt off the front of a string.
 *
 * @param string $data   Bytes.
 * @param int    $offset Position, moved past the VarInt.
 * @return int|false
 */
function lilahcraft_unpack_varint( $data, &$offset ) {
	$value = 0;
	for ( $i = 0; $i < 5; $i++ ) {
		if ( ! isset( $data[ $offset ] ) ) {
			return false;
		}
		$b      = ord( $data[ $offset ] );
		$value |= ( $b & 0x7F ) << ( 7 * $i );
		++$offset;
		if ( ! ( $b & 0x80 ) ) {
			return $value;
		}
	}
	return false;
}

/**
 * Ping a Java server.
 *
 * @param string $host    Address players type in.
 * @param int    $port    Port.
 * @param int    $timeout Seconds for the whole exchange.
 * @return array|WP_Error { players: int, max: int, version: string }
 */
function lilahcraft_ping( $host, $port, $timeout = 3 ) {
	if ( ! function_exists( 'stream_socket_client' ) ) {
		return new WP_Error( 'lilahcraft_ping', 'Sockets are not available.' );
	}
	$deadline = microtime( true ) + $timeout;

	// Minecraft clients honour an SRV record when no port is given; do the same for the default port.
	$target = $host;
	$tport  = $port;
	if ( 25565 === $port && function_exists( 'dns_get_record' ) && ! filter_var( $host, FILTER_VALIDATE_IP ) ) {
		$srv = @dns_get_record( '_minecraft._tcp.' . $host, DNS_SRV ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
		if ( is_array( $srv ) && ! empty( $srv[0]['target'] ) && ! empty( $srv[0]['port'] ) ) {
			$target = rtrim( $srv[0]['target'], '.' );
			$tport  = (int) $srv[0]['port'];
		}
	}

	$errno  = 0;
	$errstr = '';
	$wait   = max( 0.5, $deadline - microtime( true ) );
	$sock   = @stream_socket_client( 'tcp://' . $target . ':' . $tport, $errno, $errstr, $wait ); // phpcs:ignore WordPress.PHP.NoSilencedErrors.Discouraged
	if ( ! $sock ) {
		return new WP_Error( 'lilahcraft_ping', $errstr ? $errstr : 'Could not connect.' );
	}

	$handshake = "\x00" . lilahcraft_varint( -1 ) . lilahcraft_varint( strlen( $host ) ) . $host . pack( 'n', $tport ) . lilahcraft_varint( 1 );
	$packets   = lilahcraft_varint( strlen( $handshake ) ) . $handshake . lilahcraft_varint( 1 ) . "\x00";

	stream_set_timeout( $sock, $timeout );
	$written = fwrite( $sock, $packets );
	if ( strlen( $packets ) !== $written ) {
		fclose( $sock );
		return new WP_Error( 'lilahcraft_ping', 'Could not send the ping.' );
	}

	$length = lilahcraft_read_varint( $sock, $deadline );
	if ( false === $length || $length < 3 || $length > 2097152 ) {
		fclose( $sock );
		return new WP_Error( 'lilahcraft_ping', 'No answer.' );
	}
	$body = lilahcraft_read_bytes( $sock, $length, $deadline );
	fclose( $sock );
	if ( false === $body ) {
		return new WP_Error( 'lilahcraft_ping', 'The answer was cut short.' );
	}

	$offset = 0;
	$id     = lilahcraft_unpack_varint( $body, $offset );
	$strlen = lilahcraft_unpack_varint( $body, $offset );
	if ( 0 !== $id || false === $strlen ) {
		return new WP_Error( 'lilahcraft_ping', 'Unexpected answer.' );
	}
	$json = json_decode( substr( $body, $offset, $strlen ), true );
	if ( ! is_array( $json ) || ! isset( $json['players']['online'] ) ) {
		return new WP_Error( 'lilahcraft_ping', 'The answer had no player count.' );
	}

	$version = isset( $json['version']['name'] ) && is_string( $json['version']['name'] ) ? $json['version']['name'] : '';
	$version = trim( preg_replace( '/\x{00A7}./u', '', $version ) );

	return array(
		'players' => max( 0, (int) $json['players']['online'] ),
		'max'     => isset( $json['players']['max'] ) ? max( 0, (int) $json['players']['max'] ) : 0,
		'version' => sanitize_text_field( $version ),
	);
}
