<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

use PDO;

/**
 * Enforces a global minimum spacing between outbound Nominatim requests using a MySQL
 * row lock (not filesystem flock()), so it works correctly even across multiple PHP
 * processes (e.g. multiple `php -S` workers, or PHP-FPM workers).
 */
final class NominatimRateLimiter
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly float $minIntervalSeconds
    ) {
    }

    /**
     * Runs $callback with the global limiter held, sleeping first if necessary to keep
     * spacing since the last recorded call, then records the new call time.
     *
     * @template T
     * @param callable(): T $callback
     * @return T
     */
    public function throttle(callable $callback): mixed
    {
        $this->pdo->beginTransaction();
        try {
            $stmt = $this->pdo->query('SELECT last_request_at FROM nominatim_rate_limit WHERE id = 1 FOR UPDATE');
            $row = $stmt->fetch();
            $lastRequestAt = $row['last_request_at'] ?? null;

            if ($lastRequestAt !== null) {
                $elapsed = microtime(true) - (float) $lastRequestAt;
                $remaining = $this->minIntervalSeconds - $elapsed;
                if ($remaining > 0) {
                    usleep((int) round($remaining * 1_000_000));
                }
            }

            $result = $callback();

            $update = $this->pdo->prepare('UPDATE nominatim_rate_limit SET last_request_at = ? WHERE id = 1');
            $update->execute([microtime(true)]);

            $this->pdo->commit();

            return $result;
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }
}
