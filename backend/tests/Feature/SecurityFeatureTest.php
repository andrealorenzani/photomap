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
}
