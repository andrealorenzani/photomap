<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * Only checks routing/auth-gating here (no network call is made). Cache/rounding/rate-limit
 * behavior against a fake client is covered by tests/Unit/GeocodeControllerTest.php — the
 * live server always wires the real NominatimClient, which must never be exercised in
 * automated tests.
 */
final class GeocodeFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testUnauthenticatedGeocodeRequestIs401(): void
    {
        $this->http->resetCookies();
        $response = $this->http->get('/api/geocode?lat=45.0&lon=9.0');

        $this->assertSame(401, $response->status);
    }
}
