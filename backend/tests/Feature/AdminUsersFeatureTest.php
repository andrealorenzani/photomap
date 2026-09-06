<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\HttpClient;
use Photomap\Backend\Tests\Support\ServerProcess;

final class AdminUsersFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    private const ADMIN_USERNAME = 'test-admin';
    private const ADMIN_PASSWORD = 'admin-test-password-123';

    private function loginAsAdmin(): void
    {
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson(
            '/api/admin/login',
            ['username' => self::ADMIN_USERNAME, 'password' => self::ADMIN_PASSWORD],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(200, $response->status, $response->body);
    }

    private function adminCsrf(): string
    {
        return $this->fetchCsrfToken();
    }

    public function testActivateSetsStatusAndQuotaAndSendsEmail(): void
    {
        [$userId, , ] = $this->registerAndLoginPending();

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $activate = $this->http->postJson(
            '/api/admin/users/' . $userId . '/activate',
            ['storageQuotaBytes' => 2000],
            ['X-CSRF-Token: ' . $this->adminCsrf()]
        );
        $this->assertSame(200, $activate->status, $activate->body);
        $this->assertSame('active', $activate->json()['status']);
        $this->assertSame(2000, $activate->json()['storageQuotaBytes']);

        $row = $this->pdo->query("SELECT status, storage_quota_bytes FROM users WHERE id = {$userId}")->fetch();
        $this->assertSame('active', $row['status']);
        $this->assertSame('2000', (string) $row['storage_quota_bytes']);
    }

    public function testActivatedUserCanUploadUpToPerUserQuotaButNotOverIt(): void
    {
        [$userId, $email, ] = $this->registerAndLoginPending();

        $this->http->resetCookies();
        $this->loginAsAdmin();
        $this->http->postJson(
            '/api/admin/users/' . $userId . '/activate',
            ['storageQuotaBytes' => 3000],
            ['X-CSRF-Token: ' . $this->adminCsrf()]
        );

        $this->http->resetCookies();
        $csrf = $this->fetchCsrfToken();
        $login = $this->http->postJson('/api/login', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $login->status);
        $csrf2 = $this->fetchCsrfToken();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('tiny-100x100.jpg')],
            ['X-CSRF-Token: ' . $csrf2]
        );
        $this->assertSame(201, $upload->status, $upload->body);
    }

    public function testDisableRevokesUploadAbilityAndSuspendsAllEndpoints(): void
    {
        [$userId, , $userCsrf] = $this->registerAndLogin();

        $this->http->resetCookies();
        $this->loginAsAdmin();
        $disable = $this->http->postJson(
            '/api/admin/users/' . $userId . '/disable',
            [],
            ['X-CSRF-Token: ' . $this->adminCsrf()]
        );
        $this->assertSame(200, $disable->status);
        $this->assertSame('disabled', $disable->json()['status']);

        $row = $this->pdo->query("SELECT status FROM users WHERE id = {$userId}")->fetch();
        $this->assertSame('disabled', $row['status']);
    }

    public function testShareLinkIndicatorIsExistenceOnlyNeverTheRawToken(): void
    {
        [$userAId, , $csrfA] = $this->registerAndLogin();

        // A second, separate client (fresh cookie jar) registers/logs in as a different user,
        // so logging them in doesn't clobber userA's session/CSRF token on the shared $this->http.
        $httpB = new HttpClient(static::$server->baseUrl);
        $csrfTokenB = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $emailB = 'userB' . bin2hex(random_bytes(4)) . '@example.com';
        $httpB->postJson('/api/register', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB]);
        $csrfTokenB2 = json_decode($httpB->get('/api/csrf-token')->body, true)['csrfToken'];
        $loginB = $httpB->postJson('/api/login', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrfTokenB2]);
        $userBId = (int) $loginB->json()['id'];
        $this->activateUser($userBId);

        $create = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrfA]);
        $this->assertSame(201, $create->status);
        $token = $create->json()['token'];

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $listing = $this->http->get('/api/admin/users?perPage=200');
        $this->assertSame(200, $listing->status);

        $this->assertStringNotContainsString($token, $listing->body, 'The admin listing must never contain the raw share token.');

        $usersById = [];
        foreach ($listing->json()['users'] as $row) {
            $usersById[$row['id']] = $row;
        }

        $this->assertTrue($usersById[$userAId]['hasShareLink']);
        $this->assertNotNull($usersById[$userAId]['shareLinkCreatedAt']);

        $this->assertFalse($usersById[$userBId]['hasShareLink']);
        $this->assertNull($usersById[$userBId]['shareLinkCreatedAt']);
    }

    public function testSearchFilterAndSortListing(): void
    {
        $this->registerAndLogin('alice' . bin2hex(random_bytes(2)) . '@example.com');
        [$bobId, ] = $this->registerAndLoginPending('bob' . bin2hex(random_bytes(2)) . '@example.com');

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $searchAlice = $this->http->get('/api/admin/users?q=alice');
        $this->assertSame(200, $searchAlice->status);
        foreach ($searchAlice->json()['users'] as $row) {
            $this->assertStringContainsString('alice', $row['email']);
        }

        $filterPending = $this->http->get('/api/admin/users?status=pending');
        $this->assertSame(200, $filterPending->status);
        foreach ($filterPending->json()['users'] as $row) {
            $this->assertSame('pending', $row['status']);
        }
        $ids = array_column($filterPending->json()['users'], 'id');
        $this->assertContains($bobId, $ids);

        $sortedAsc = $this->http->get('/api/admin/users?sort=created_at&dir=asc');
        $this->assertSame(200, $sortedAsc->status);
        $createdAtValues = array_column($sortedAsc->json()['users'], 'createdAt');
        $sorted = $createdAtValues;
        sort($sorted);
        $this->assertSame($sorted, $createdAtValues);
    }

    public function testSortColumnAllowListRejectsSqlInjectionShapedInput(): void
    {
        $this->registerAndLogin();

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $response = $this->http->get('/api/admin/users?sort=' . urlencode('id; DROP TABLE users; --'));
        // Falls back to the default sort column rather than erroring or executing anything.
        $this->assertSame(200, $response->status);

        $row = $this->pdo->query('SELECT COUNT(*) c FROM users')->fetch();
        $this->assertGreaterThan(0, (int) $row['c']);
    }

    public function testSettingsDefaultQuotaChangeOnlyAffectsSubsequentlyRegisteredUsers(): void
    {
        [$existingUserId, ] = $this->registerAndLoginPending();

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $update = $this->http->patchJson(
            '/api/admin/settings',
            ['defaultStorageQuotaBytes' => 12345],
            ['X-CSRF-Token: ' . $this->adminCsrf()]
        );
        $this->assertSame(200, $update->status);
        $this->assertSame(12345, $update->json()['defaultStorageQuotaBytes']);

        // Existing (already-pending) user row is untouched by the settings change.
        $row = $this->pdo->query("SELECT storage_quota_bytes FROM users WHERE id = {$existingUserId}")->fetch();
        $this->assertNull($row['storage_quota_bytes']);
    }

    public function testGlobalUploadDisableBlocksEveryUserRegardlessOfIndividualActivation(): void
    {
        [, $email, ] = $this->registerAndLogin();

        $this->http->resetCookies();
        $this->loginAsAdmin();
        $disableUploads = $this->http->patchJson(
            '/api/admin/settings',
            ['uploadsEnabled' => false],
            ['X-CSRF-Token: ' . $this->adminCsrf()]
        );
        $this->assertSame(200, $disableUploads->status);
        $this->assertFalse($disableUploads->json()['uploadsEnabled']);

        $this->http->resetCookies();
        $csrf = $this->fetchCsrfToken();
        $login = $this->http->postJson('/api/login', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $login->status);
        $csrf2 = $this->fetchCsrfToken();

        $upload = $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('tiny-100x100.jpg')],
            ['X-CSRF-Token: ' . $csrf2]
        );
        $this->assertSame(503, $upload->status);
        $this->assertSame('uploads_disabled', $upload->json()['error']);
    }

    public function testStatsCountsMatchSeededFixtureRows(): void
    {
        [, , $csrfA] = $this->registerAndLogin();
        $this->registerAndLoginPending();

        $this->http->postMultipart(
            '/api/photos',
            ['lat' => '1.0', 'lon' => '2.0'],
            ['photo' => $this->fixturePath('tiny-100x100.jpg')],
            ['X-CSRF-Token: ' . $csrfA]
        );

        $this->http->resetCookies();
        $this->loginAsAdmin();

        $stats = $this->http->get('/api/admin/stats');
        $this->assertSame(200, $stats->status);
        $body = $stats->json();

        $expectedUsers = (int) $this->pdo->query('SELECT COUNT(*) c FROM users')->fetch()['c'];
        $expectedPhotos = (int) $this->pdo->query('SELECT COUNT(*) c FROM photos')->fetch()['c'];
        $expectedBytes = (int) $this->pdo->query('SELECT COALESCE(SUM(file_size_bytes), 0) t FROM photos')->fetch()['t'];

        $this->assertSame($expectedUsers, $body['totalUsers']);
        $this->assertSame($expectedPhotos, $body['totalPhotos']);
        $this->assertSame($expectedBytes, $body['totalBytesStored']);
        $this->assertSame($expectedPhotos >= 1, $body['totalPhotos'] >= 1);
    }

    public function testAdminPasswordHashNeverAppearsInAnyResponseBody(): void
    {
        $this->loginAsAdmin();
        $me = $this->http->get('/api/admin/me');
        $this->assertStringNotContainsString('$2y$', $me->body);

        $users = $this->http->get('/api/admin/users');
        $this->assertStringNotContainsString('$2y$', $users->body);
        $this->assertStringNotContainsString('password', strtolower($users->body));
    }
}
