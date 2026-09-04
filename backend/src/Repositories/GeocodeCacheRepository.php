<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class GeocodeCacheRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{place_name: ?string}|null
     */
    public function find(float $latRounded, float $lonRounded): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT place_name FROM geocode_cache WHERE lat_rounded = ? AND lon_rounded = ?'
        );
        $stmt->execute([$latRounded, $lonRounded]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function put(float $latRounded, float $lonRounded, ?string $placeName): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO geocode_cache (lat_rounded, lon_rounded, place_name, fetched_at)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE place_name = VALUES(place_name), fetched_at = VALUES(fetched_at)'
        );
        $stmt->execute([$latRounded, $lonRounded, $placeName]);
    }
}
