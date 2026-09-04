<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Services\StorageQuotaService;
use Photomap\Backend\Tests\Support\DatabaseTestCase;

final class StorageQuotaServiceTest extends DatabaseTestCase
{
    private function createUser(string $email = 'quota@example.com'): int
    {
        $stmt = $this->pdo->prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)');
        $stmt->execute([$email, password_hash('irrelevant', PASSWORD_DEFAULT)]);

        return (int) $this->pdo->lastInsertId();
    }

    public function testUploadUnderQuotaSucceeds(): void
    {
        $userId = $this->createUser();
        $users = new UserRepository($this->pdo);
        $photos = new PhotoRepository($this->pdo);
        $quota = new StorageQuotaService($this->pdo, $users, $photos, 1_000_000);

        $result = $quota->reserveAndInsert($userId, 100, function () use ($photos, $userId) {
            return $photos->create($userId, 'photos/x.jpg', 'thumbnails/x.jpg', 100, null, null, null, null, null);
        });

        $this->assertTrue($result['ok']);
        $this->assertSame(100, $photos->sumBytesForUser($userId));
    }

    public function testUploadThatWouldCrossQuotaIsRejectedWithoutInserting(): void
    {
        $userId = $this->createUser();
        $users = new UserRepository($this->pdo);
        $photos = new PhotoRepository($this->pdo);
        $quota = new StorageQuotaService($this->pdo, $users, $photos, 1000);

        $photos->create($userId, 'photos/a.jpg', 'thumbnails/a.jpg', 900, null, null, null, null, null);

        $inserted = false;
        $result = $quota->reserveAndInsert($userId, 200, function () use ($photos, $userId, &$inserted) {
            $inserted = true;

            return $photos->create($userId, 'photos/b.jpg', 'thumbnails/b.jpg', 200, null, null, null, null, null);
        });

        $this->assertFalse($result['ok']);
        $this->assertFalse($inserted);
        $this->assertSame(900, $photos->sumBytesForUser($userId));
    }

    public function testOneUsersUsageDoesNotAffectAnother(): void
    {
        $userA = $this->createUser('a@example.com');
        $userB = $this->createUser('b@example.com');
        $photos = new PhotoRepository($this->pdo);

        $photos->create($userA, 'photos/a.jpg', 'thumbnails/a.jpg', 900_000, null, null, null, null, null);

        $this->assertSame(900_000, $photos->sumBytesForUser($userA));
        $this->assertSame(0, $photos->sumBytesForUser($userB));
    }

    public function testFreedSpaceAfterDeletionPermitsNewUpload(): void
    {
        $userId = $this->createUser();
        $users = new UserRepository($this->pdo);
        $photos = new PhotoRepository($this->pdo);
        $quota = new StorageQuotaService($this->pdo, $users, $photos, 1000);

        $id = $photos->create($userId, 'photos/a.jpg', 'thumbnails/a.jpg', 900, null, null, null, null, null);

        $blocked = $quota->reserveAndInsert($userId, 200, fn () => $photos->create($userId, 'photos/b.jpg', 'thumbnails/b.jpg', 200, null, null, null, null, null));
        $this->assertFalse($blocked['ok']);

        $photos->deleteForUser($id, $userId);

        $allowed = $quota->reserveAndInsert($userId, 200, fn () => $photos->create($userId, 'photos/c.jpg', 'thumbnails/c.jpg', 200, null, null, null, null, null));
        $this->assertTrue($allowed['ok']);
    }

    /**
     * Proves the row-lock genuinely serializes concurrent uploads from the same user: two
     * real OS processes each attempt an upload that individually fits under quota but
     * jointly would exceed it, fired at nearly the same time. Exactly one must succeed.
     */
    public function testConcurrentUploadsFromSameUserAreSerializedBySameLock(): void
    {
        $userId = $this->createUser('concurrent@example.com');

        // Quota of 1000 bytes; each upload is 600 bytes. Individually fine, jointly (1200) over.
        $quotaBytes = 1000;
        $newBytes = 600;
        $sleepMicroseconds = 300_000; // 300ms hold inside the locked section, to widen the race window.

        $workerScript = __DIR__ . '/../Support/concurrent_upload_worker.php';

        $descriptorSpec = [1 => ['pipe', 'w'], 2 => ['pipe', 'w']];

        $cmd1 = sprintf('php %s %d %d %d %d', escapeshellarg($workerScript), $userId, $newBytes, $quotaBytes, $sleepMicroseconds);
        $cmd2 = $cmd1;

        $proc1 = proc_open($cmd1, $descriptorSpec, $pipes1);
        $proc2 = proc_open($cmd2, $descriptorSpec, $pipes2);

        $this->assertIsResource($proc1);
        $this->assertIsResource($proc2);

        $out1 = stream_get_contents($pipes1[1]);
        $err1 = stream_get_contents($pipes1[2]);
        fclose($pipes1[1]);
        fclose($pipes1[2]);
        proc_close($proc1);

        $out2 = stream_get_contents($pipes2[1]);
        $err2 = stream_get_contents($pipes2[2]);
        fclose($pipes2[1]);
        fclose($pipes2[2]);
        proc_close($proc2);

        $results = [trim($out1), trim($out2)];
        sort($results);

        $this->assertSame(['OK', 'REJECTED'], $results, "Worker stderr: {$err1} | {$err2}");

        $photos = new PhotoRepository($this->pdo);
        $this->assertSame($newBytes, $photos->sumBytesForUser($userId), 'Exactly one upload should have persisted.');
    }
}
