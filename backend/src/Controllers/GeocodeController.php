<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\GeocodeCacheRepository;
use Photomap\Backend\Services\GeocodeClientInterface;
use Photomap\Backend\Services\NominatimRateLimiter;

final class GeocodeController
{
    public function __construct(
        private readonly GeocodeCacheRepository $cache,
        private readonly GeocodeClientInterface $client,
        private readonly NominatimRateLimiter $rateLimiter
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        $latRaw = $request->query('lat');
        $lonRaw = $request->query('lon');

        if ($latRaw === null || $lonRaw === null || !is_numeric($latRaw) || !is_numeric($lonRaw)) {
            return JsonResponse::error('invalid_coordinates', 'lat and lon query parameters are required and must be numeric.', 400);
        }

        $lat = (float) $latRaw;
        $lon = (float) $lonRaw;

        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
            return JsonResponse::error('invalid_coordinates', 'lat/lon out of range.', 400);
        }

        $latRounded = round($lat, 4);
        $lonRounded = round($lon, 4);

        $cached = $this->cache->find($latRounded, $lonRounded);
        if ($cached !== null) {
            return new JsonResponse(['placeName' => $cached['place_name'], 'lat' => $latRounded, 'lon' => $lonRounded]);
        }

        $placeName = $this->rateLimiter->throttle(fn () => $this->client->lookup($latRounded, $lonRounded));

        $this->cache->put($latRounded, $lonRounded, $placeName);

        return new JsonResponse(['placeName' => $placeName, 'lat' => $latRounded, 'lon' => $lonRounded]);
    }
}
