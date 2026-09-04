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
        private readonly int $quotaBytes
    ) {
    }

    /**
     * Row-locks the user, sums current usage, and checks whether adding $newBytes would
     * exceed the quota. If it fits, $onAccepted(usedBytes) is invoked (expected to perform
     * the INSERT) and the transaction is committed. If it does not fit, the transaction is
     * rolled back and $onAccepted is never called.
     *
     * @return array{ok: bool, usedBytes: int, quotaBytes: int, insertId: ?int}
     */
    public function reserveAndInsert(int $userId, int $newBytes, callable $onAccepted): array
    {
        $this->pdo->beginTransaction();
        try {
            $this->userRepository->lockForUpdate($userId);
            $usedBytes = $this->photoRepository->sumBytesForUser($userId);

            if ($usedBytes + $newBytes > $this->quotaBytes) {
                $this->pdo->rollBack();

                return ['ok' => false, 'usedBytes' => $usedBytes, 'quotaBytes' => $this->quotaBytes, 'insertId' => null];
            }

            $insertId = $onAccepted($usedBytes);

            $this->pdo->commit();

            return ['ok' => true, 'usedBytes' => $usedBytes, 'quotaBytes' => $this->quotaBytes, 'insertId' => $insertId];
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }
    }

    public function quotaBytes(): int
    {
        return $this->quotaBytes;
    }
}
