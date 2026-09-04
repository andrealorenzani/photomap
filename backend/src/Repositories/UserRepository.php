<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class UserRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, email, password_hash, created_at FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT id, email, password_hash, created_at FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function create(string $email, string $passwordHash): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
        $stmt->execute([$email, $passwordHash]);

        return (int) $this->pdo->lastInsertId();
    }

    public function updatePasswordHash(int $userId, string $passwordHash): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $stmt->execute([$passwordHash, $userId]);
    }

    public function delete(int $userId): void
    {
        $stmt = $this->pdo->prepare('DELETE FROM users WHERE id = ?');
        $stmt->execute([$userId]);
    }

    /**
     * Locks the user row for the duration of the current transaction (used by the
     * storage-quota check to serialize concurrent uploads from the same account).
     */
    public function lockForUpdate(int $userId): bool
    {
        $stmt = $this->pdo->prepare('SELECT id FROM users WHERE id = ? FOR UPDATE');
        $stmt->execute([$userId]);

        return $stmt->fetch() !== false;
    }
}
