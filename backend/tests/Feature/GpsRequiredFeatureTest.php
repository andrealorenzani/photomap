<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * Server-side defense-in-depth for requirement 5: account-mode uploads discard GPS-less
 * photos client-side, but a client that bypasses that check must not succeed against the API
 * either. There is no "guest mode" on this server — every authenticated upload here is a
 * non-guest account, so this rejection is unconditional.
 */
final class GpsRequiredFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testUploadWithoutLatLonIsRejectedWithGpsRequired(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $before = $this->countStoredFiles();
        $upload = $this->http->postMultipart('/api/photos', [], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $after = $this->countStoredFiles();

        $this->assertSame(422, $upload->status);
        $this->assertSame('gps_required', $upload->json()['error']);
        $this->assertSame($before, $after, 'A rejected upload must leave no orphaned files on disk.');

        $row = $this->pdo->query('SELECT COUNT(*) c FROM photos')->fetch();
        $this->assertSame('0', (string) $row['c']);
    }

    public function testUploadWithNullIslandCoordinatesIsRejected(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '0', 'lon' => '0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );

        $this->assertSame(422, $upload->status);
        $this->assertSame('gps_required', $upload->json()['error']);
    }

    public function testUploadWithRealCoordinatesStillSucceeds(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '45.1234', 'lon' => '9.5678'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );

        $this->assertSame(201, $upload->status, $upload->body);
    }

    /**
     * Regression guard: PATCH (assign-a-location-later) must still work for a GPS-less row
     * that pre-dates this enforcement (inserted directly, since the upload API can no longer
     * create such a row) — the forward-only policy change explicitly does not retroactively
     * touch/backfill existing rows.
     */
    public function testPatchStillWorksOnPreExistingGpsLessRow(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $update = $this->http->patchJson('/api/photos/' . $id, ['lat' => 12.0, 'lon' => 34.0], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(200, $update->status);
        $this->assertSame(12.0, $update->json()['lat']);
    }

    private function countStoredFiles(): int
    {
        $storagePath = rtrim((string) \Photomap\Backend\Config::get('STORAGE_PATH'), '/');
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
