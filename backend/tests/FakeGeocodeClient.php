<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests;

use Photomap\Backend\Services\GeocodeClientInterface;

final class FakeGeocodeClient implements GeocodeClientInterface
{
    public int $callCount = 0;

    /** @var array<int, array{lat: float, lon: float}> */
    public array $calls = [];

    /**
     * @param array<string, ?string> $responses Keyed by "lat,lon" (rounded) -> place name (or null for "no result").
     */
    public function __construct(
        private readonly array $responses = [],
        private readonly ?string $defaultPlaceName = 'Fake Place, Test Country'
    ) {
    }

    public function lookup(float $lat, float $lon): ?string
    {
        $this->callCount++;
        $this->calls[] = ['lat' => $lat, 'lon' => $lon];

        $key = $lat . ',' . $lon;
        if (array_key_exists($key, $this->responses)) {
            return $this->responses[$key];
        }

        return $this->defaultPlaceName;
    }
}
