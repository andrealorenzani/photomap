<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Config;
use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\HttpClient;
use Photomap\Backend\Tests\Support\ServerProcess;

final class OwnershipFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testUserCannotDeleteAnotherUsersPhoto(): void
    {
        [$userAId, , $csrfA] = $this->registerAndLogin();
        $upload = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrfA]);
        $photoId = $upload->json()['id'];

        $row = $this->pdo->query("SELECT storage_path, thumbnail_path FROM photos WHERE id = {$photoId}")->fetch();
        $storagePath = rtrim((string) Config::get('STORAGE_PATH'), '/');

        // A second, separate client (fresh cookie jar) registers/logs in as a different user.
        $httpB = new HttpClient(static::$server->baseUrl);
        $csrfTokenB = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $emailB = 'userB' . bin2hex(random_bytes(4)) . '@example.com';
        $httpB->postJson('/api/register', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB]);
        $csrfTokenB2 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $httpB->postJson('/api/login', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB2]);
        $csrfTokenB3 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];

        $deleteAsB = $httpB->delete('/api/photos/' . $photoId, ['X-CSRF-Token: ' . $csrfTokenB3]);
        $this->assertSame(404, $deleteAsB->status);

        // Files untouched.
        $this->assertFileExists($storagePath . '/' . $row['storage_path']);
        $this->assertFileExists($storagePath . '/' . $row['thumbnail_path']);

        // Owner can still delete it.
        $deleteAsOwner = $this->http->delete('/api/photos/' . $photoId, ['X-CSRF-Token: ' . $csrfA]);
        $this->assertSame(200, $deleteAsOwner->status);
    }

    public function testDeletingUnauthenticatedIs401AndNonexistentIs404(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $this->http->resetCookies();
        $unauth = $this->http->delete('/api/photos/999999');
        $this->assertSame(401, $unauth->status);

        [, , $csrf2] = $this->registerAndLogin();
        $notFound = $this->http->delete('/api/photos/999999', ['X-CSRF-Token: ' . $csrf2]);
        $this->assertSame(404, $notFound->status);
    }

    public function testGetPhotosNeverReturnsAnotherUsersRows(): void
    {
        [$userAId, , $csrfA] = $this->registerAndLogin();
        $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrfA]);

        [$userBId, , $csrfB] = $this->registerAndLogin();
        $this->http->postMultipart('/api/photos', ['lat' => '3.0', 'lon' => '4.0'], ['photo' => $this->fixturePath('tiny-100x100.jpg')], ['X-CSRF-Token: ' . $csrfB]);

        $list = $this->http->get('/api/photos');
        $this->assertCount(1, $list->json()['photos']);
    }

    public function testDeleteAccountOnlyAffectsThatUsersData(): void
    {
        [$userAId, $emailA, $csrfA] = $this->registerAndLogin();
        $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrfA]);

        $httpB = new HttpClient(static::$server->baseUrl);
        $csrfTokenB = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $emailB = 'survivor' . bin2hex(random_bytes(4)) . '@example.com';
        $registerB = $httpB->postJson('/api/register', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB]);
        $userBId = json_decode($registerB->body, true)['id'];
        $this->activateUser((int) $userBId);
        $csrfTokenB2 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $httpB->postJson('/api/login', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB2]);
        $csrfTokenB3 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $httpB->postMultipart('/api/photos', ['lat' => '3.0', 'lon' => '4.0'], ['photo' => $this->fixturePath('tiny-100x100.jpg')], ['X-CSRF-Token: ' . $csrfTokenB3]);

        $deleteAccount = $this->http->delete('/api/account', ['X-CSRF-Token: ' . $csrfA]);
        $this->assertSame(200, $deleteAccount->status);

        $userExists = $this->pdo->query("SELECT COUNT(*) c FROM users WHERE id = {$userAId}")->fetch()['c'];
        $this->assertSame('0', (string) $userExists);

        $bStillExists = $this->pdo->query("SELECT COUNT(*) c FROM users WHERE id = {$userBId}")->fetch()['c'];
        $this->assertSame('1', (string) $bStillExists);

        $bPhotos = $httpB->get('/api/photos');
        $this->assertSame(200, $bPhotos->status);
        $this->assertCount(1, $bPhotos->json()['photos']);

        $afterDeleteMe = $this->http->get('/api/me');
        $this->assertSame(401, $afterDeleteMe->status);
    }
}
