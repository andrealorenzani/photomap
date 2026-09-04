<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * Verifies the Secure attribute is present on the Set-Cookie header when APP_ENV=production.
 *
 * Known limitation (documented, not faked): this only proves the server *sends* the Secure
 * attribute in the header text. Actual browser-side enforcement of Secure (refusing to send
 * the cookie back over plain HTTP) cannot be verified in this local `php -S` test setup,
 * since our test HTTP client doesn't emulate browser cookie-jar security policy.
 */
final class ProductionCookieFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    protected static function envOverrides(): array
    {
        return ['APP_ENV' => 'production'];
    }

    public function testSecureAttributePresentWhenAppEnvIsProduction(): void
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
        $this->assertStringContainsStringIgnoringCase('Secure', $cookieHeader);
    }
}
