<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class CorsFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    private const ALLOWED_ORIGIN = 'https://photomap.example';

    protected static function envOverrides(): array
    {
        return ['CORS_ALLOWED_ORIGINS' => self::ALLOWED_ORIGIN . ',https://second.example'];
    }

    public function testPreflightForExactAllowListedOriginGetsCorrectHeaders(): void
    {
        $response = $this->http->options('/api/photos', [
            'Origin: ' . self::ALLOWED_ORIGIN,
            'Access-Control-Request-Method: PATCH',
            'Access-Control-Request-Headers: Content-Type, X-CSRF-Token',
        ]);

        $this->assertSame(204, $response->status);
        $this->assertSame(self::ALLOWED_ORIGIN, $response->header('Access-Control-Allow-Origin'));
        $this->assertSame('true', $response->header('Access-Control-Allow-Credentials'));
        $this->assertNotNull($response->header('Access-Control-Allow-Methods'));
        $this->assertStringContainsString('X-CSRF-Token', (string) $response->header('Access-Control-Allow-Headers'));
        $this->assertSame('Origin', $response->header('Vary'));
    }

    public function testActualRequestFromAllowListedOriginGetsAllowOriginHeader(): void
    {
        $response = $this->http->get('/api/csrf-token', ['Origin: ' . self::ALLOWED_ORIGIN]);

        $this->assertSame(200, $response->status);
        $this->assertSame(self::ALLOWED_ORIGIN, $response->header('Access-Control-Allow-Origin'));
        $this->assertSame('true', $response->header('Access-Control-Allow-Credentials'));
    }

    public function testNoAllowOriginHeaderEmittedWhenOriginNotAllowListed(): void
    {
        $response = $this->http->get('/api/csrf-token', ['Origin: https://not-allowed.example']);

        $this->assertSame(200, $response->status);
        // Not just "absent from some assertion" — genuinely no header key at all, since a
        // present-but-wrong-value header would still (incorrectly) let some clients proceed.
        $this->assertNull($response->header('Access-Control-Allow-Origin'));
        $this->assertNull($response->header('Access-Control-Allow-Credentials'));
    }

    public function testPreflightForNonAllowListedOriginEmitsNoAllowOriginHeader(): void
    {
        $response = $this->http->options('/api/photos', [
            'Origin: https://not-allowed.example',
            'Access-Control-Request-Method: PATCH',
        ]);

        $this->assertSame(204, $response->status);
        $this->assertNull($response->header('Access-Control-Allow-Origin'));
        $this->assertNull($response->header('Access-Control-Allow-Methods'));
    }

    public function testNearMissSuffixOriginIsRejectedNotFuzzyMatched(): void
    {
        // Allow-list has https://photomap.example; a suffix/subdomain-lookalike attacker
        // origin must never pass via substring/suffix matching.
        $suffixAttack = $this->http->get('/api/csrf-token', ['Origin: https://photomap.example.evil.com']);
        $this->assertNull($suffixAttack->header('Access-Control-Allow-Origin'));

        $prefixAttack = $this->http->get('/api/csrf-token', ['Origin: https://evil-photomap.example']);
        $this->assertNull($prefixAttack->header('Access-Control-Allow-Origin'));
    }

    public function testNoOriginHeaderMeansNoCorsHeadersButRequestStillWorks(): void
    {
        $response = $this->http->get('/api/csrf-token');

        $this->assertSame(200, $response->status);
        $this->assertNull($response->header('Access-Control-Allow-Origin'));
    }
}
