<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Config;
use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * Runs with the admin-configurable global default quota (app_settings.default_storage_quota_bytes)
 * lowered to a tiny value so quota exhaustion can be reached with small fixture uploads
 * instead of needing ~100MB of data. Quota is no longer a deploy-time env var (see
 * StorageQuotaService/AppSettingsService), so this is set directly against the DB in setUp()
 * rather than via a server env override.
 */
final class QuotaFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    protected function setUp(): void
    {
        parent::setUp();
        // Small enough that a handful of tiny fixture uploads (~1-2KB each after
        // resize+thumbnail) will exceed it, without needing to upload real megabytes.
        $this->pdo->exec('UPDATE app_settings SET default_storage_quota_bytes = 5000 WHERE id = 1');
    }

    public function testUploadsEventuallyExceedQuotaCleanlyWithNoOrphanedFiles(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $successes = 0;
        $rejection = null;

        for ($i = 0; $i < 20; $i++) {
            $before = $this->countStoredFiles();
            $response = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('tiny-100x100.jpg')], ['X-CSRF-Token: ' . $csrf]);
            $after = $this->countStoredFiles();

            if ($response->status === 201) {
                $successes++;
                $this->assertSame($before + 2, $after, 'A successful upload should add exactly 2 files (main + thumbnail).');
                continue;
            }

            $rejection = $response;
            $this->assertSame($before, $after, 'A rejected upload must leave no orphaned files on disk.');
            break;
        }

        $this->assertNotNull($rejection, 'Expected to eventually hit the quota with repeated uploads.');
        $this->assertSame(413, $rejection->status);
        $this->assertSame('quota_exceeded', $rejection->json()['error']);
        $this->assertArrayHasKey('quotaBytes', $rejection->json());
        $this->assertArrayHasKey('usedBytes', $rejection->json());
        $this->assertSame(5000, $rejection->json()['quotaBytes']);
        $this->assertGreaterThanOrEqual(1, $successes);
    }

    public function testFreedSpaceAfterDeletionPermitsNewUpload(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $ids = [];
        $rejection = null;
        for ($i = 0; $i < 20; $i++) {
            $response = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('tiny-100x100.jpg')], ['X-CSRF-Token: ' . $csrf]);
            if ($response->status === 201) {
                $ids[] = $response->json()['id'];
                continue;
            }
            $rejection = $response;
            break;
        }

        $this->assertNotNull($rejection);
        $this->assertNotEmpty($ids);

        $this->http->delete('/api/photos/' . $ids[0], ['X-CSRF-Token: ' . $csrf]);

        $retry = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('tiny-100x100.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $retry->status);
    }

    private function countStoredFiles(): int
    {
        $storagePath = rtrim((string) Config::get('STORAGE_PATH'), '/');
        $count = 0;
        foreach (['photos', 'thumbnails'] as $sub) {
            $dir = $storagePath . '/' . $sub;
            if (!is_dir($dir)) {
                continue;
            }
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                if ($file->isFile()) {
                    $count++;
                }
            }
        }

        return $count;
    }
}
