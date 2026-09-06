<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class UserRepository
{
    /**
     * Allow-list of columns that GET /api/admin/users?sort= may sort by — never interpolate
     * a client-supplied value directly into ORDER BY.
     */
    private const SORT_COLUMNS = ['created_at', 'email'];

    private const VALID_STATUSES = ['pending', 'active', 'disabled'];

    private const SELECT_COLUMNS = 'id, email, password_hash, status, storage_quota_bytes, approved_at, created_at';

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function findByEmail(string $email): ?array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE email = ?');
        $stmt->execute([$email]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    public function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT ' . self::SELECT_COLUMNS . ' FROM users WHERE id = ?');
        $stmt->execute([$id]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * New accounts always land as 'pending' (the column's schema default) — approval is an
     * explicit, separate admin action (see activate()).
     */
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
     * storage-quota check to serialize concurrent uploads from the same account). Returns
     * the row (including its per-user quota override) so the caller doesn't need a second
     * query while holding the lock.
     */
    public function lockForUpdate(int $userId): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, status, storage_quota_bytes FROM users WHERE id = ? FOR UPDATE'
        );
        $stmt->execute([$userId]);
        $row = $stmt->fetch();

        return $row === false ? null : $row;
    }

    /**
     * Admin action: approves a pending (or re-approves a disabled) account, optionally
     * setting a per-user storage quota override (null = fall back to the global default).
     */
    public function activate(int $userId, ?int $storageQuotaBytes): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE users SET status = ?, storage_quota_bytes = ?, approved_at = NOW() WHERE id = ?'
        );
        $stmt->execute(['active', $storageQuotaBytes, $userId]);
    }

    /**
     * Admin action: fully suspends an account. Any already-open session for this account is
     * not proactively invalidated (no cross-session store exists in this design, the same
     * documented limitation as account deletion) — it fails on its next DB-touching request
     * once AccountStatusMiddleware runs.
     */
    public function disable(int $userId): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET status = ? WHERE id = ?');
        $stmt->execute(['disabled', $userId]);
    }

    /**
     * Admin listing: search by email substring, optionally filter by status, sorted by an
     * allow-listed column. Never accepts a raw client-supplied column/direction string
     * without validating it against a fixed list first.
     *
     * @return array<int, array<string, mixed>>
     */
    public function search(string $query, ?string $status, string $sort, string $dir, int $page, int $perPage): array
    {
        $sortColumn = in_array($sort, self::SORT_COLUMNS, true) ? $sort : 'created_at';
        $direction = strtolower($dir) === 'asc' ? 'ASC' : 'DESC';

        $conditions = [];
        $params = [];

        if ($query !== '') {
            $conditions[] = 'email LIKE ?';
            $params[] = '%' . $query . '%';
        }

        if ($status !== null && in_array($status, self::VALID_STATUSES, true)) {
            $conditions[] = 'status = ?';
            $params[] = $status;
        }

        $where = $conditions === [] ? '' : ('WHERE ' . implode(' AND ', $conditions));

        $page = max(1, $page);
        $perPage = max(1, min(200, $perPage));
        $offset = ($page - 1) * $perPage;

        $sql = "SELECT id, email, status, storage_quota_bytes, approved_at, created_at
                FROM users
                {$where}
                ORDER BY {$sortColumn} {$direction}
                LIMIT {$perPage} OFFSET {$offset}";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll();
    }

    public function count(string $query, ?string $status): int
    {
        $conditions = [];
        $params = [];

        if ($query !== '') {
            $conditions[] = 'email LIKE ?';
            $params[] = '%' . $query . '%';
        }

        if ($status !== null && in_array($status, self::VALID_STATUSES, true)) {
            $conditions[] = 'status = ?';
            $params[] = $status;
        }

        $where = $conditions === [] ? '' : ('WHERE ' . implode(' AND ', $conditions));

        $stmt = $this->pdo->prepare("SELECT COUNT(*) AS c FROM users {$where}");
        $stmt->execute($params);

        return (int) $stmt->fetch()['c'];
    }

    /**
     * @return array{pending: int, active: int, disabled: int}
     */
    public function countByStatus(): array
    {
        $counts = ['pending' => 0, 'active' => 0, 'disabled' => 0];

        $stmt = $this->pdo->query('SELECT status, COUNT(*) AS c FROM users GROUP BY status');
        foreach ($stmt->fetchAll() as $row) {
            $counts[$row['status']] = (int) $row['c'];
        }

        return $counts;
    }
}
