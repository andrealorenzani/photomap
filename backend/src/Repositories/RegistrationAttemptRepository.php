<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

/**
 * Mirrors LoginAttemptRepository's shape, but for registration anti-spam throttling: every
 * POST /api/register is recorded here regardless of outcome (unlike login_attempts, which only
 * tracks failures against an existing account -- registration has no equivalent "succeeded"
 * concept worth distinguishing for rate-limiting purposes).
 */
final class RegistrationAttemptRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function record(string $ipAddress): void
    {
        $stmt = $this->pdo->prepare('INSERT INTO registration_attempts (ip_address) VALUES (?)');
        $stmt->execute([$ipAddress]);
    }

    public function countRecentByIp(string $ipAddress, int $windowSeconds): int
    {
        $stmt = $this->pdo->prepare(
            'SELECT COUNT(*) AS c FROM registration_attempts
             WHERE ip_address = ? AND created_at >= (NOW() - INTERVAL ? SECOND)'
        );
        $stmt->execute([$ipAddress, $windowSeconds]);
        $row = $stmt->fetch();

        return (int) ($row['c'] ?? 0);
    }
}
