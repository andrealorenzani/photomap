<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class SecurityFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testSessionCookieIsHttpOnlyAndSameSiteLax(): void
    {
        $response = $this->http->get('/api/csrf-token');
        $cookieHeader = null;
        foreach ($response->setCookieHeaders() as $header) {
            if (str_starts_with($header, 'photomap_session_test=')) {
                $cookieHeader = $header;
                break;
            }
        }

        $this->assertNotNull($cookieHeader);
        $this->assertStringContainsStringIgnoringCase('HttpOnly', $cookieHeader);
        $this->assertStringContainsStringIgnoringCase('SameSite=Lax', $cookieHeader);
    }

    public function testStorageDirectoryIsNotWebReachable(): void
    {
        // The storage/ directory lives outside public/ entirely, so `php -S -t public` has no
        // route to it at all — any guessed direct path must 404, never serve file bytes.
        $response = $this->http->get('/storage/photos/1/anything.jpg');
        $this->assertSame(404, $response->status);

        $response2 = $this->http->get('/../storage/photos/1/anything.jpg');
        $this->assertNotSame(200, $response2->status);
    }

    public function testNoStrayConfigPhpShadowsEnvTestFixtures(): void
    {
        // Config::load() checks for a config.php in the backend root before falling back to
        // .env/.env.test (see the shared-hosting deploy support). This suite's
        // real backend root must never have a stray config.php sitting next to .env.test, or
        // every Feature test would silently start running against whatever that stray file
        // says instead of the intended .env.test fixture — this is a regression guard for that,
        // not just an assumption.
        $backendRoot = dirname(__DIR__, 2);
        $this->assertFileDoesNotExist(
            $backendRoot . '/config.php',
            'A stray backend/config.php would shadow .env.test for the whole Feature suite (see Config::load()).'
        );

        // Positive-side confirmation that .env.test genuinely is the active source: its
        // dedicated test-only session cookie name should be the one the live server sends.
        $response = $this->http->get('/api/csrf-token');
        $cookieHeader = null;
        foreach ($response->setCookieHeaders() as $header) {
            if (str_starts_with($header, 'photomap_session_test=')) {
                $cookieHeader = $header;
                break;
            }
        }
        $this->assertNotNull($cookieHeader, 'Expected the .env.test-configured session cookie name to be in use.');
    }
}
