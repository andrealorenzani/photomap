<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Services\ImageProcessor;
use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class PhotosFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    protected static function envOverrides(): array
    {
        // Lowered from the 25MB production default so the oversized-file test doesn't need
        // to exceed PHP's own default `upload_max_filesize`/`post_max_size` ini limits
        // (2M/8M) just to exercise our application-level MAX_UPLOAD_BYTES check. All other
        // fixtures used in this class are well under 1MB.
        return ['MAX_UPLOAD_BYTES' => '1048576'];
    }

    public function testUploadWithoutAuthIs401(): void
    {
        $this->http->resetCookies();
        $response = $this->http->postMultipart('/api/photos', [], ['photo' => $this->fixturePath('small-800x600.jpg')]);
        $this->assertSame(401, $response->status);
    }

    public function testLargeJpegUploadIsResizedAndListed(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '45.1234', 'lon' => '9.5678', 'takenAt' => '2024-06-01 12:00:00', 'cameraMake' => 'Acme', 'cameraModel' => 'X100'],
            ['photo' => $this->fixturePath('large-2400x1600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );

        $this->assertSame(201, $upload->status, $upload->body);
        $body = $upload->json();
        $this->assertSame(45.1234, $body['lat']);
        $this->assertSame(9.5678, $body['lon']);
        $this->assertSame('Acme', $body['cameraMake']);
        $this->assertNotEmpty($body['thumbnailUrl']);
        $this->assertNotEmpty($body['previewUrl']);

        $list = $this->http->get('/api/photos');
        $this->assertSame(200, $list->status);
        $this->assertCount(1, $list->json()['photos']);
    }

    public function testGpslessUploadIsRejectedWithGpsRequired(): void
    {
        // As of the admin-approval-gate/GPS-required release, account-mode uploads without
        // GPS are rejected server-side (defense-in-depth for the client-side discard) rather
        // than accepted as a valid no-GPS photo.
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart('/api/photos', [], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $upload->status);
        $this->assertSame('gps_required', $upload->json()['error']);

        $list = $this->http->get('/api/photos');
        $this->assertCount(0, $list->json()['photos']);
    }

    public function testNullIslandCoordinatesAreTreatedAsNoGpsAndRejected(): void
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

    public function testTextFileRenamedJpgIsRejectedByContentSniffing(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart('/api/photos', [], ['photo' => $this->fixturePath('not-an-image.jpg')], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $upload->status);
        $this->assertSame('invalid_file_type', $upload->json()['error']);
    }

    public function testCorruptedJpegIsRejectedWithNoOrphanedFiles(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $before = $this->countStoredFiles();
        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('corrupted.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $after = $this->countStoredFiles();

        $this->assertSame(422, $upload->status);
        $this->assertSame($before, $after);
    }

    public function testMaliciousFilenameIsIgnoredAndStorageIsServerGenerated(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();

        // curl always sends a client filename; we rename our fixture on the fly via CURLFile's
        // third constructor argument through postMultipart's basename() usage — simulate a
        // traversal attempt by copying the fixture to a path with a dangerous basename.
        $maliciousPath = sys_get_temp_dir() . '/' . '..-..-evil.jpg';
        copy($this->fixturePath('small-800x600.jpg'), sys_get_temp_dir() . '/evil-source.jpg');
        rename(sys_get_temp_dir() . '/evil-source.jpg', $maliciousPath);

        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $maliciousPath], ['X-CSRF-Token: ' . $csrf]);
        @unlink($maliciousPath);

        $this->assertSame(201, $upload->status);
        $row = $this->pdo->query('SELECT storage_path FROM photos WHERE user_id = ' . $userId)->fetch();
        $this->assertDoesNotMatchRegularExpression('/evil/', $row['storage_path']);
        $this->assertDoesNotMatchRegularExpression('/\.\./', $row['storage_path']);
    }

    public function testOversizedFileIsRejectedBeforeFullDecode(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        // This class overrides MAX_UPLOAD_BYTES down to 1MB (see envOverrides()) so this
        // oversized file (1.2MB) exceeds our application limit while staying safely under
        // PHP's own default upload_max_filesize (2M) / post_max_size (8M) ini limits —
        // otherwise PHP itself would silently drop the upload before our code ever runs.
        $oversizedPath = sys_get_temp_dir() . '/oversized-' . bin2hex(random_bytes(4)) . '.jpg';
        $handle = fopen($oversizedPath, 'wb');
        fwrite($handle, "\xFF\xD8\xFF\xE0"); // JPEG magic bytes, then padding.
        fseek($handle, (int) (1.2 * 1024 * 1024) - 1);
        fwrite($handle, "\0");
        fclose($handle);

        $upload = $this->http->postMultipart('/api/photos', [], ['photo' => $oversizedPath], ['X-CSRF-Token: ' . $csrf]);
        @unlink($oversizedPath);

        $this->assertSame(413, $upload->status);
        $this->assertSame('file_too_large', $upload->json()['error']);
    }

    public function testWebpUploadFallbackBehavior(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small.webp')], ['X-CSRF-Token: ' . $csrf]);

        if (ImageProcessor::isWebpSupported()) {
            $this->assertSame(201, $upload->status, $upload->body);
        } else {
            $this->assertSame(422, $upload->status);
            $this->assertSame('webp_unsupported', $upload->json()['error']);
        }
    }

    public function testSignedImageUrlServesAndRejectsTamperedSignature(): void
    {
        [, , $csrf] = $this->registerAndLogin();
        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $previewUrl = $upload->json()['previewUrl'];

        $ok = $this->http->get($previewUrl);
        $this->assertSame(200, $ok->status);
        $this->assertSame('image/jpeg', $ok->header('Content-Type'));

        $tamperedUrl = preg_replace('/sig=[a-f0-9]+/', 'sig=' . str_repeat('0', 64), $previewUrl);
        $tampered = $this->http->get($tamperedUrl);
        $this->assertSame(403, $tampered->status);

        $expiredUrl = preg_replace('/expires=\d+/', 'expires=1', $previewUrl);
        $expired = $this->http->get($expiredUrl);
        $this->assertSame(403, $expired->status);
    }

    public function testDeletePhotoRemovesRowAndFiles(): void
    {
        [, , $csrf] = $this->registerAndLogin();
        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $id = $upload->json()['id'];

        $row = $this->pdo->query("SELECT storage_path, thumbnail_path FROM photos WHERE id = {$id}")->fetch();
        $storagePath = rtrim((string) \Photomap\Backend\Config::get('STORAGE_PATH'), '/');
        $this->assertFileExists($storagePath . '/' . $row['storage_path']);

        $delete = $this->http->delete('/api/photos/' . $id, ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $delete->status);

        $this->assertFileDoesNotExist($storagePath . '/' . $row['storage_path']);
        $this->assertFileDoesNotExist($storagePath . '/' . $row['thumbnail_path']);
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
