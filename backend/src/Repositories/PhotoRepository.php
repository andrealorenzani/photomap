<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class PhotoRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findAllForUser(int $userId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, user_id, storage_path, thumbnail_path, file_size_bytes, lat, lon,
                    taken_at, camera_make, camera_model, created_at
             FROM photos WHERE user_id = ? ORDER BY taken_at IS NULL, taken_at ASC, id ASC'
        );
        $stmt->execute([$userId]);

        return $stmt->fetchAll();
    }

    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, user_id, storage_path, thumbnail_path, file_size_bytes, lat, lon,
                    taken_at, camera_make, camera_model, created_at
             FROM photos WHERE id = ?'
        );
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function sumBytesForUser(int $userId): int
    {
        $stmt = $this->pdo->prepare('SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM photos WHERE user_id = ?');
        $stmt->execute([$userId]);
        $row = $stmt->fetch();

        return (int) ($row['total'] ?? 0);
    }

    public function create(
        int $userId,
        string $storagePath,
        string $thumbnailPath,
        int $fileSizeBytes,
        ?float $lat,
        ?float $lon,
        ?string $takenAt,
        ?string $cameraMake,
        ?string $cameraModel
    ): int {
        $stmt = $this->pdo->prepare(
            'INSERT INTO photos
                (user_id, storage_path, thumbnail_path, file_size_bytes, lat, lon, taken_at, camera_make, camera_model)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $userId, $storagePath, $thumbnailPath, $fileSizeBytes, $lat, $lon, $takenAt, $cameraMake, $cameraModel,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    /**
     * Updates a photo's location. Ownership must already be verified by the caller (via
     * find()) before calling this — the WHERE clause here is defense-in-depth, not the sole
     * ownership check, and this method deliberately does not report success/failure via
     * rowCount(): a no-op update (e.g. dragging a marker back to its original spot) reports 0
     * affected rows under PDO/MySQL's default "rows changed" semantics, which would be a
     * false-negative trap if used as a success signal.
     */
    public function updateLocation(int $id, int $userId, float $lat, float $lon): void
    {
        $stmt = $this->pdo->prepare('UPDATE photos SET lat = ?, lon = ? WHERE id = ? AND user_id = ?');
        $stmt->execute([$lat, $lon, $id, $userId]);
    }

    public function deleteForUser(int $id, int $userId): bool
    {
        $stmt = $this->pdo->prepare('DELETE FROM photos WHERE id = ? AND user_id = ?');
        $stmt->execute([$id, $userId]);

        return $stmt->rowCount() > 0;
    }

    /**
     * @return array<int, array{storage_path: string, thumbnail_path: string}>
     */
    public function findFilePathsForUser(int $userId): array
    {
        $stmt = $this->pdo->prepare('SELECT storage_path, thumbnail_path FROM photos WHERE user_id = ?');
        $stmt->execute([$userId]);

        return $stmt->fetchAll();
    }

    /**
     * Admin listing support: a single aggregated GROUP BY query for every user's storage
     * usage, instead of one query per row (N+1).
     *
     * @return array<int, int> Keyed by user_id.
     */
    public function sumBytesGroupedByUser(): array
    {
        $stmt = $this->pdo->query('SELECT user_id, SUM(file_size_bytes) AS total FROM photos GROUP BY user_id');
        $result = [];
        foreach ($stmt->fetchAll() as $row) {
            $result[(int) $row['user_id']] = (int) $row['total'];
        }

        return $result;
    }

    public function countAll(): int
    {
        return (int) $this->pdo->query('SELECT COUNT(*) AS c FROM photos')->fetch()['c'];
    }

    public function sumAllBytes(): int
    {
        return (int) $this->pdo->query('SELECT COALESCE(SUM(file_size_bytes), 0) AS total FROM photos')->fetch()['total'];
    }
}
