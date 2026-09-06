<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

use PDO;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\UserRepository;

final class StorageQuotaService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly UserRepository $userRepository,
        private readonly PhotoRepository $photoRepository,
        private readonly AppSettingsService $appSettings
    ) {
    }

    /**
     * Row-locks the user, resolves their effective quota (their own per-user override, or
     * the admin-configured global default when they don't have one), sums current usage, and
     * checks whether adding $newBytes would exceed it. If it fits, $onAccepted(usedBytes) is
     * invoked (expected to perform the INSERT) and the transaction is committed. If it does
     * not fit, the transaction is rolled back and $onAccepted is never called.
     *
     * MySQL can pick this transaction as a deadlock victim under concurrent access from the
     * same/related rows (e.g. a plain UPDATE on the same user row racing with this SELECT ...
     * FOR UPDATE + INSERT). A deadlock (SQLSTATE 40001) is retried a couple of times with a
     * brief backoff, which is the standard way to handle MySQL deadlocks, rather than surfacing
     * it to the caller as an uncaught error.
     *
     * @return array{ok: bool, usedBytes: int, quotaBytes: int, insertId: ?int}
     */
    public function reserveAndInsert(int $userId, int $newBytes, callable $onAccepted): array
    {
        $maxAttempts = 3;

        for ($attempt = 1; $attempt <= $maxAttempts; $attempt++) {
            try {
                return $this->attemptReserveAndInsert($userId, $newBytes, $onAccepted);
            } catch (\PDOException $e) {
                $isDeadlock = $e->getCode() === '40001'
                    || (isset($e->errorInfo[1]) && (int) $e->errorInfo[1] === 1213);

                if (!$isDeadlock || $attempt >= $maxAttempts) {
                    throw $e;
                }

                // Brief randomized backoff before retrying, so two competing transactions
                // don't immediately deadlock again in lockstep.
                usleep(random_int(10_000, 50_000) * $attempt);
            }
        }

        // Unreachable: the loop above always either returns or throws.
        throw new \LogicException('reserveAndInsert exhausted retries without returning or throwing.');
    }

    /**
     * @return array{ok: bool, usedBytes: int, quotaBytes: int, insertId: ?int}
     */
    private function attemptReserveAndInsert(int $userId, int $newBytes, callable $onAccepted): array
    {
        $this->pdo->beginTransaction();
        try {
            $user = $this->userRepository->lockForUpdate($userId);
            $quotaBytes = $this->resolveQuotaBytes($user);
            $usedBytes = $this->photoRepository->sumBytesForUser($userId);

            if ($usedBytes + $newBytes > $quotaBytes) {
                $this->pdo->rollBack();

                return ['ok' => false, 'usedBytes' => $usedBytes, 'quotaBytes' => $quotaBytes, 'insertId' => null];
            }

            $insertId = $onAccepted($usedBytes);

            $this->pdo->commit();

            return ['ok' => true, 'usedBytes' => $usedBytes, 'quotaBytes' => $quotaBytes, 'insertId' => $insertId];
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    public function quotaBytesForUser(int $userId): int
    {
        return $this->resolveQuotaBytes($this->userRepository->findById($userId));
    }

    /**
     * @param array<string, mixed>|null $user
     */
    private function resolveQuotaBytes(?array $user): int
    {
        if ($user !== null && $user['storage_quota_bytes'] !== null) {
            return (int) $user['storage_quota_bytes'];
        }

        return $this->appSettings->getDefaultQuotaBytes();
    }
}
