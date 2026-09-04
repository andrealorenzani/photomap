<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Tests\Support\FakeHttpServer;

/**
 * Verifies NominatimClient's actual wire behavior (User-Agent header, response parsing)
 * against a local fake HTTP server — never the real Nominatim endpoint.
 */
final class NominatimClientTest extends TestCase
{
    public function testSendsConfiguredUserAgentAndParsesDisplayName(): void
    {
        $userAgent = 'Photomap-Test/1.0 (contact: dev-test@example.com)';
        $server = new FakeHttpServer(json_encode(['display_name' => 'Test City, Test Country']));

        $workerScript = __DIR__ . '/../Support/nominatim_lookup_worker.php';
        $cmd = sprintf(
            'php %s %s %s 45.0 9.0',
            escapeshellarg($workerScript),
            escapeshellarg($server->url),
            escapeshellarg($userAgent)
        );

        $descriptorSpec = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = proc_open($cmd, $descriptorSpec, $pipes);
        $this->assertIsResource($proc);

        $rawRequest = $server->captureOneRequest();

        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        $server->close();

        $this->assertStringContainsString('User-Agent: ' . $userAgent, $rawRequest, "stderr: {$err}");
        $this->assertStringContainsString('GET /reverse', $rawRequest);

        $decoded = json_decode((string) $out, true);
        $this->assertSame('Test City, Test Country', $decoded['result'] ?? null);
    }

    public function testReturnsNullWhenResponseHasNoDisplayName(): void
    {
        $server = new FakeHttpServer(json_encode(['error' => 'Unable to geocode']));

        $workerScript = __DIR__ . '/../Support/nominatim_lookup_worker.php';
        $cmd = sprintf(
            'php %s %s %s 0.0 0.0',
            escapeshellarg($workerScript),
            escapeshellarg($server->url),
            escapeshellarg('Photomap-Test/1.0')
        );

        $descriptorSpec = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];
        $proc = proc_open($cmd, $descriptorSpec, $pipes);
        $this->assertIsResource($proc);

        $server->captureOneRequest();

        $out = stream_get_contents($pipes[1]);
        $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        proc_close($proc);
        $server->close();

        $decoded = json_decode((string) $out, true);
        $this->assertArrayHasKey('result', $decoded, "out=[{$out}] err=[{$err}]");
        $this->assertNull($decoded['result']);
    }
}
