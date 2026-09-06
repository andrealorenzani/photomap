<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

/**
 * Boots `php -S` as a real subprocess for Feature tests, with a configurable env override
 * (e.g. a tiny STORAGE_QUOTA_BYTES for quota tests, or a short RATE_LIMIT window).
 */
final class ServerProcess
{
    /** @var resource */
    private $process;

    private array $pipes = [];

    public readonly int $port;

    public readonly string $baseUrl;

    /**
     * @param array<string, string> $envOverrides
     */
    public function __construct(array $envOverrides = [])
    {
        $root = dirname(__DIR__, 2);
        $this->port = self::findFreePort();
        $this->baseUrl = "http://127.0.0.1:{$this->port}";

        $env = array_merge($this->baseEnv($root), $envOverrides);

        $descriptorSpec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $command = sprintf(
            'exec php -S 127.0.0.1:%d -t %s %s',
            $this->port,
            escapeshellarg($root . '/public'),
            escapeshellarg($root . '/public/index.php')
        );

        $this->process = proc_open($command, $descriptorSpec, $this->pipes, $root, $env);

        if (!is_resource($this->process)) {
            throw new \RuntimeException('Failed to start php -S server process.');
        }

        stream_set_blocking($this->pipes[1], false);
        stream_set_blocking($this->pipes[2], false);

        $this->waitUntilReady();
    }

    public function stop(): void
    {
        if (is_resource($this->process)) {
            $status = proc_get_status($this->process);
            if ($status['running'] ?? false) {
                proc_terminate($this->process, 15);
                // Give it a brief moment to exit cleanly.
                for ($i = 0; $i < 20; $i++) {
                    $status = proc_get_status($this->process);
                    if (!($status['running'] ?? false)) {
                        break;
                    }
                    usleep(50_000);
                }
            }
            foreach ($this->pipes as $pipe) {
                if (is_resource($pipe)) {
                    fclose($pipe);
                }
            }
            proc_close($this->process);
        }
    }

    private function baseEnv(string $root): array
    {
        // Load the same .env.test values used by Unit tests, as a base to override from.
        // $_SERVER can contain non-scalar entries (e.g. 'argv'/'argc') that proc_open's $env
        // parameter can't handle, so only scalar values are carried over.
        $env = array_filter($_SERVER, static fn ($value) => is_scalar($value));
        $lines = file($root . '/.env.test', FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }
            [$key, $value] = array_pad(explode('=', $line, 2), 2, '');
            $value = trim($value);
            if (strlen($value) >= 2
                && (
                    ($value[0] === '"' && $value[-1] === '"')
                    || ($value[0] === "'" && $value[-1] === "'")
                )
            ) {
                $value = substr($value, 1, -1);
            }
            $env[trim($key)] = $value;
        }

        return $env;
    }

    private function waitUntilReady(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $conn = @fsockopen('127.0.0.1', $this->port, $errno, $errstr, 0.2);
            if ($conn !== false) {
                fclose($conn);

                return;
            }
            usleep(50_000);
        }

        throw new \RuntimeException("Server did not become ready on port {$this->port}");
    }

    private static function findFreePort(): int
    {
        $server = stream_socket_server('tcp://127.0.0.1:0', $errno, $errstr);
        if ($server === false) {
            throw new \RuntimeException("Could not find a free port: {$errstr}");
        }

        $name = stream_socket_get_name($server, false);
        fclose($server);

        $parts = explode(':', $name);

        return (int) end($parts);
    }
}
