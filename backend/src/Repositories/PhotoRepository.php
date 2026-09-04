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
}
