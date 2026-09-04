<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

final class LoginAttemptRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function record(string $email, string $ipAddress, bool $succeeded): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO login_attempts (email, ip_address, succeeded) VALUES (?, ?, ?)'
        );
        $stmt->execute([$email, $ipAddress, $succeeded ? 1 : 0]);
    }

    public function countRecentFailuresByEmail(string $email, int $windowSeconds): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS c FROM login_attempts
             WHERE email = ? AND succeeded = 0 AND created_at >= (NOW() - INTERVAL ? SECOND)'
        );
        $stmt->execute([$email, $windowSeconds]);
        $row = $stmt->fetch();

        return (int) ($row['c'] ?? 0);
    }

    public function countRecentFailuresByIp(string $ipAddress, int $windowSeconds): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS c FROM login_attempts
             WHERE ip_address = ? AND succeeded = 0 AND created_at >= (NOW() - INTERVAL ? SECOND)'
        );
        $stmt->execute([$ipAddress, $windowSeconds]);
        $row = $stmt->fetch();

        return (int) ($row['c'] ?? 0);
    }
}
