<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Controllers\GeocodeController;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\GeocodeCacheRepository;
use Photomap\Backend\Services\NominatimRateLimiter;
use Photomap\Backend\Tests\FakeGeocodeClient;
use Photomap\Backend\Tests\Support\DatabaseTestCase;

final class GeocodeControllerTest extends DatabaseTestCase
{
    private function makeController(FakeGeocodeClient $client, float $minInterval = 0.1): GeocodeController
    {
        return new GeocodeController(
            new GeocodeCacheRepository($this->pdo),
            $client,
            new NominatimRateLimiter($this->pdo, $minInterval)
        );
    }

    private function request(string $lat, string $lon): Request
    {
        return new Request(['lat' => $lat, 'lon' => $lon], [], [], []);
    }

    public function testCacheMissCallsClientOnceAndCaches(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $response = $controller->show($this->request('45.12345', '9.54321'));

        $this->assertSame(1, $client->callCount);
        $body = json_decode($this->captureBody($response), true);
        $this->assertSame('Fake Place, Test Country', $body['placeName']);
    }

    public function testSameRoundedBucketServedFromCacheWithoutFurtherCalls(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $controller->show($this->request('45.123401', '9.543201'));
        // Both round to the same 4-decimal bucket (45.1234, 9.5432).
        $controller->show($this->request('45.123422', '9.543222'));

        $this->assertSame(1, $client->callCount);
    }

    public function testOutOfBucketTriggersFreshCall(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $controller->show($this->request('45.1000', '9.1000'));
        $controller->show($this->request('46.2000', '10.2000'));

        $this->assertSame(2, $client->callCount);
    }

    public function testMalformedLatLonReturns400WithNoDownstreamCall(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $response = $controller->show($this->request('not-a-number', '9.0'));

        $this->assertSame(0, $client->callCount);
        $this->assertResponseStatus(400, $response);
    }

    public function testOutOfRangeLatLonReturns400(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $response = $controller->show($this->request('999', '9.0'));

        $this->assertSame(0, $client->callCount);
        $this->assertResponseStatus(400, $response);
    }

    public function testNoResultIsCachedAsExplicitNull(): void
    {
        $client = new FakeGeocodeClient([], null);
        $controller = $this->makeController($client);

        $first = $controller->show($this->request('1.0000', '1.0000'));
        $body = json_decode($this->captureBody($first), true);
        $this->assertNull($body['placeName']);

        $controller->show($this->request('1.0000', '1.0000'));
        $this->assertSame(1, $client->callCount, 'Second lookup for the same empty-result bucket should hit the cache.');
    }

    public function testTwoRapidUncachedLookupsAreSerializedByConfiguredSpacing(): void
    {
        $client = new FakeGeocodeClient();
        $controller = $this->makeController($client);

        $start = microtime(true);
        $controller->show($this->request('10.0000', '10.0000'));
        $controller->show($this->request('20.0000', '20.0000'));
        $elapsed = microtime(true) - $start;

        $this->assertGreaterThanOrEqual(0.09, $elapsed);
    }

    private function captureBody($jsonResponse): string
    {
        // JsonResponse doesn't expose body publicly by design (send()-only), so use
        // reflection here purely for test introspection.
        $ref = new \ReflectionProperty($jsonResponse, 'body');
        $ref->setAccessible(true);

        return $ref->getValue($jsonResponse);
    }

    private function assertResponseStatus(int $expected, $jsonResponse): void
    {
        $ref = new \ReflectionProperty($jsonResponse, 'status');
        $ref->setAccessible(true);

        $this->assertSame($expected, $ref->getValue($jsonResponse));
    }
}
