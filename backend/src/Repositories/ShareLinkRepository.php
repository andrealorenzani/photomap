<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class ShareLinkRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function revokeActiveForUser(int $userId): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE share_links SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL'
        );
        $stmt->execute([$userId]);
    }

    public function create(int $userId, string $token): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO share_links (user_id, token) VALUES (?, ?)');
        $stmt->execute([$userId, $token]);

        return (int) $this->pdo->lastInsertId();
    }

    public function findActiveByToken(string $token): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, user_id, token, created_at, revoked_at
             FROM share_links WHERE token = ? AND revoked_at IS NULL'
        );
        $stmt->execute([$token]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, user_id, token, created_at, revoked_at FROM share_links WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function revokeForUser(int $id, int $userId): bool
    {
        $stmt = $this->pdo->prepare(
            'UPDATE share_links SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL'
        );
        $stmt->execute([$id, $userId]);

        return $stmt->rowCount() > 0;
    }

    public function isTokenActive(string $token): bool
    {
        return $this->findActiveByToken($token) !== null;
    }

    /**
     * Admin-support existence/timestamp indicator only — deliberately selects nothing but
     * `created_at`. The admin console must never see a user's actual share token/URL (which
     * would hand the admin real, bearer-capable viewing access to that user's shared photos
     * without their knowledge); see docs/plans.md for the reasoning behind this restriction.
     *
     * @return array{createdAt: string}|null
     */
    public function findActiveCreatedAtForUser(int $userId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT created_at FROM share_links WHERE user_id = ? AND revoked_at IS NULL
             ORDER BY created_at DESC LIMIT 1'
        );
        $stmt->execute([$userId]);
        $row = $stmt->fetch();

        return $row === false ? null : ['createdAt' => $row['created_at']];
    }
}
