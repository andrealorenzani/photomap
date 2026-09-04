<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

/**
 * A minimal single-request raw-socket HTTP server used only to verify what our own HTTP
 * client (NominatimClient) actually sends on the wire (e.g. the User-Agent header),
 * without ever making a real network call to Nominatim.
 */
final class FakeHttpServer
{
    public readonly string $url;

    /** @var resource */
    private $socket;

    public function __construct(private readonly string $responseBody, private readonly int $statusCode = 200)
    {
        $this->socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        if ($this->socket === false) {
            throw new \RuntimeException("Could not start fake HTTP server: {$errstr}");
        }
        $name = stream_socket_get_name($this->socket, false);
        $this->url = 'http://' . $name . '/reverse';
    }

    /**
     * Accepts exactly one connection, replies with the configured body, and returns the
     * raw request text (including headers) that was received.
     */
    public function captureOneRequest(float $timeoutSeconds = 5.0): string
    {
        stream_set_timeout($this->socket, (int) $timeoutSeconds);
        $conn = @stream_socket_accept($this->socket, $timeoutSeconds);
        if ($conn === false) {
            throw new \RuntimeException('Fake HTTP server did not receive a connection in time.');
        }

        $request = '';
        while (($line = fgets($conn)) !== false) {
            $request .= $line;
            if (trim($line) === '') {
                break;
            }
        }

        $body = $this->responseBody;
        $response = "HTTP/1.1 {$this->statusCode} OK\r\n"
            . "Content-Type: application/json\r\n"
            . 'Content-Length: ' . strlen($body) . "\r\n"
            . "Connection: close\r\n\r\n"
            . $body;

        fwrite($conn, $response);
        fclose($conn);

        return $request;
    }

    public function close(): void
    {
        if (is_resource($this->socket)) {
            fclose($this->socket);
        }
    }
}
