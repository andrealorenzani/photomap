<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

final class NominatimClient implements GeocodeClientInterface
{
    public function __construct(
        private readonly string $userAgent,
        private readonly int $timeoutSeconds = 5,
        // Overridable only for tests, so we can point at a local fake server instead of
        // ever calling the real Nominatim endpoint.
        private readonly string $baseUrl = 'https://nominatim.openstreetmap.org/reverse'
    ) {
    }

    public function lookup(float $lat, float $lon): ?string
    {
        $url = $this->baseUrl . '?' . http_build_query([
            'format' => 'jsonv2',
            'lat' => $lat,
            'lon' => $lon,
        ]);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['User-Agent: ' . $this->userAgent],
            CURLOPT_TIMEOUT => $this->timeoutSeconds,
            CURLOPT_FOLLOWLOCATION => true,
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false || $httpCode !== 200) {
            return null;
        }

        $decoded = json_decode((string) $response, true);
        if (!is_array($decoded) || !isset($decoded['display_name']) || !is_string($decoded['display_name'])) {
            return null;
        }

        return $decoded['display_name'];
    }
}
