<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class RegistrationApprovalFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testRegisterCreatesPendingAccount(): void
    {
        $email = 'pending' . bin2hex(random_bytes(4)) . '@example.com';
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], [
            'X-CSRF-Token: ' . $csrf,
        ]);

        $this->assertSame(201, $response->status);
        $this->assertSame('pending', $response->json()['status']);

        $row = $this->pdo->query('SELECT status FROM users WHERE email = ' . $this->pdo->quote($email))->fetch();
        $this->assertSame('pending', $row['status']);
    }

    public function testLoginSucceedsForAPendingAccount(): void
    {
        $this->registerAndLoginPending();

        $me = $this->http->get('/api/me');
        $this->assertSame(200, $me->status);
        $this->assertSame('pending', $me->json()['status']);
    }

    public function testUploadIsRejectedForAPendingAccount(): void
    {
        [, , $csrf] = $this->registerAndLoginPending();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );

        $this->assertSame(403, $upload->status);
        $this->assertSame('account_pending', $upload->json()['error']);

        $row = $this->pdo->query('SELECT COUNT(*) c FROM photos')->fetch();
        $this->assertSame('0', (string) $row['c']);

        $storagePath = rtrim((string) \Photomap\Backend\Config::get('STORAGE_PATH'), '/');
        foreach (['photos', 'thumbnails'] as $sub) {
            $dir = $storagePath . '/' . $sub;
            if (!is_dir($dir)) {
                continue;
            }
            $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS));
            foreach ($iterator as $file) {
                $this->fail('No file should be written under storage/ for a rejected pending-account upload.');
            }
        }
    }

    public function testUploadSucceedsOnceActivated(): void
    {
        [$userId, , $csrf] = $this->registerAndLoginPending();

        $blocked = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(403, $blocked->status);

        $this->activateUser($userId);

        $retry = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(201, $retry->status, $retry->body);
    }

    public function testDisabledAccountIsFullySuspended(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();

        $this->disableUser($userId);

        $me = $this->http->get('/api/me');
        $this->assertSame(403, $me->status);
        $this->assertSame('account_disabled', $me->json()['error']);

        $list = $this->http->get('/api/photos');
        $this->assertSame(403, $list->status);
        $this->assertSame('account_disabled', $list->json()['error']);

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(403, $upload->status);
        $this->assertSame('account_disabled', $upload->json()['error']);

        $shareLinkCreate = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(403, $shareLinkCreate->status);
        $this->assertSame('account_disabled', $shareLinkCreate->json()['error']);
    }
}
