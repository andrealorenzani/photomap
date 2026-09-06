<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\HttpClient;
use Photomap\Backend\Tests\Support\ServerProcess;

final class PhotoUpdateFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testUpdateLocationSucceedsAndReflectsInResponseAndSubsequentList(): void
    {
        // As of the account-mode GPS-required release, a genuinely GPS-less row can no longer
        // be created via the upload API (see GpsRequiredFeatureTest) — this row is inserted
        // directly to simulate one that pre-dates that change, exactly the case the PATCH
        // (assign-a-location-later) workflow must keep supporting.
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $beforeList = $this->http->get('/api/photos');
        $this->assertNull($beforeList->json()['photos'][0]['lat']);

        $update = $this->http->patchJson('/api/photos/' . $id, ['lat' => 45.1234, 'lon' => 9.5678], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $update->status, $update->body);
        $body = $update->json();
        $this->assertSame(45.1234, $body['lat']);
        $this->assertSame(9.5678, $body['lon']);
        $this->assertSame($id, $body['id']);
        $this->assertNotEmpty($body['thumbnailUrl']);
        $this->assertNotEmpty($body['previewUrl']);

        $list = $this->http->get('/api/photos');
        $listed = $list->json()['photos'][0];
        $this->assertSame(45.1234, $listed['lat']);
        $this->assertSame(9.5678, $listed['lon']);
    }

    public function testUpdateAllowedForAlreadyGeotaggedPhotoToo(): void
    {
        [, , $csrf] = $this->registerAndLogin();
        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );
        $id = $upload->json()['id'];

        // Deliberately non-whole-number values: a whole-number float like 3.0 round-trips
        // through JSON as "3", which json_decode() reads back as a PHP int rather than a float,
        // making a strict assertSame(3.0, ...) fail for reasons unrelated to this endpoint.
        $update = $this->http->patchJson('/api/photos/' . $id, ['lat' => 3.5, 'lon' => 4.5], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $update->status);
        $this->assertSame(3.5, $update->json()['lat']);
        $this->assertSame(4.5, $update->json()['lon']);
    }

    public function testNoOpUpdateBackToSameCoordinatesStillReturns200(): void
    {
        // Regression guard for the rowCount() false-negative trap: an update that changes
        // nothing (dragging a marker back to its original spot) must not be treated as failure.
        [, , $csrf] = $this->registerAndLogin();
        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('small-800x600.jpg')],
            ['X-CSRF-Token: ' . $csrf]
        );
        $id = $upload->json()['id'];

        $update = $this->http->patchJson('/api/photos/' . $id, ['lat' => 1.0, 'lon' => 2.0], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $update->status);
    }

    public function testUnauthenticatedIs401(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $this->http->resetCookies();
        $response = $this->http->patchJson('/api/photos/' . $id, ['lat' => 1, 'lon' => 2]);
        $this->assertSame(401, $response->status);
    }

    public function testMissingOrInvalidCsrfIs403(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $missing = $this->http->patchJson('/api/photos/' . $id, ['lat' => 1, 'lon' => 2]);
        $this->assertSame(403, $missing->status);

        $invalid = $this->http->patchJson('/api/photos/' . $id, ['lat' => 1, 'lon' => 2], ['X-CSRF-Token: bogus']);
        $this->assertSame(403, $invalid->status);
    }

    public function testCrossAccountOwnershipIs404NotForbidden(): void
    {
        [$userAId, , $csrfA] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userAId);

        $httpB = new HttpClient(static::$server->baseUrl);
        $csrfTokenB = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $emailB = 'userB' . bin2hex(random_bytes(4)) . '@example.com';
        $registerB = $httpB->postJson('/api/register', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB]);
        $userBId = (int) json_decode($registerB->body, true)['id'];
        $this->activateUser($userBId);
        $csrfTokenB2 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $httpB->postJson('/api/login', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB2]);
        $csrfTokenB3 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];

        $updateAsB = $httpB->patchJson('/api/photos/' . $id, ['lat' => 1, 'lon' => 2], ['X-CSRF-Token: ' . $csrfTokenB3]);
        $this->assertSame(404, $updateAsB->status);

        // Original photo's coordinates untouched.
        $list = $this->http->get('/api/photos');
        $this->assertNull($list->json()['photos'][0]['lat']);
    }

    public function testNonexistentIdIs404(): void
    {
        [, , $csrf] = $this->registerAndLogin();
        $response = $this->http->patchJson('/api/photos/999999', ['lat' => 1, 'lon' => 2], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(404, $response->status);
    }

    public function testMissingCoordinatesIs422(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $missingLon = $this->http->patchJson('/api/photos/' . $id, ['lat' => 1], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(422, $missingLon->status);
        $this->assertSame('invalid_coordinates', $missingLon->json()['error']);

        $missingBoth = $this->http->patchJson('/api/photos/' . $id, [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(422, $missingBoth->status);
    }

    public function testNonNumericCoordinatesIs422(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $response = $this->http->patchJson('/api/photos/' . $id, ['lat' => 'not-a-number', 'lon' => 2], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(422, $response->status);
        $this->assertSame('invalid_coordinates', $response->json()['error']);
    }

    public function testOutOfRangeCoordinatesIs422(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $response = $this->http->patchJson('/api/photos/' . $id, ['lat' => 200, 'lon' => 2], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(422, $response->status);
        $this->assertSame('invalid_coordinates', $response->json()['error']);
    }

    public function testExtraUnexpectedBodyFieldsAreIgnoredNoMassAssignment(): void
    {
        [$userId, , $csrf] = $this->registerAndLogin();
        $id = $this->insertGpsLessPhotoForUser($userId);

        $update = $this->http->patchJson(
            '/api/photos/' . $id,
            ['lat' => 1.0, 'lon' => 2.0, 'user_id' => 999999, 'storage_path' => 'evil.jpg'],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(200, $update->status);

        $row = $this->pdo->query("SELECT user_id, storage_path FROM photos WHERE id = {$id}")->fetch();
        $this->assertSame($userId, (int) $row['user_id']);
        $this->assertStringNotContainsString('evil.jpg', $row['storage_path']);
    }
}
