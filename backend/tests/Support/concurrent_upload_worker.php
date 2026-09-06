<?php

declare(strict_types=1);

/**
 * Standalone worker used by StorageQuotaServiceTest to prove the row-lock actually
 * serializes concurrent uploads from the same user. Run as a separate OS process (not just
 * a separate PDO connection in the same process) so the two quota checks genuinely race.
 *
 * Usage: php concurrent_upload_worker.php <userId> <newBytes> <quotaBytes> <sleepMicroseconds>
 * Prints "OK" or "REJECTED" to stdout.
 */

require_once __DIR__ . '/../../vendor/autoload.php';

use Photomap\Backend\Config;
use Photomap\Backend\Database;
use Photomap\Backend\Repositories\AppSettingsRepository;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Services\AppSettingsService;
use Photomap\Backend\Services\StorageQuotaService;

Config::load(dirname(__DIR__, 2), '.env.test');

[$script, $userId, $newBytes, $quotaBytes, $sleepMicroseconds] = $argv;

$pdo = Database::connect();
$users = new UserRepository($pdo);
$photos = new PhotoRepository($pdo);
// Per-user quota override, rather than the retired global STORAGE_QUOTA_BYTES constant, so
// the appSettings default below is irrelevant to this test.
$users->activate((int) $userId, (int) $quotaBytes);
$appSettings = new AppSettingsService(new AppSettingsRepository($pdo));
$quota = new StorageQuotaService($pdo, $users, $photos, $appSettings);

$result = $quota->reserveAndInsert((int) $userId, (int) $newBytes, function () use ($photos, $userId, $newBytes, $sleepMicroseconds) {
    usleep((int) $sleepMicroseconds);

    return $photos->create(
        (int) $userId,
        'photos/' . $userId . '/' . bin2hex(random_bytes(8)) . '.jpg',
        'thumbnails/' . $userId . '/' . bin2hex(random_bytes(8)) . '.jpg',
        (int) $newBytes,
        null,
        null,
        null,
        null,
        null
    );
});

echo $result['ok'] ? 'OK' : 'REJECTED';
