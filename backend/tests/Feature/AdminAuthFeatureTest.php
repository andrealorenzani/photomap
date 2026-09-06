<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * .env.test configures ADMIN_USERNAME=test-admin, ADMIN_PASSWORD_HASH = password_hash() of
 * "admin-test-password-123" — a fixed, known-in-tests credential pair.
 */
final class AdminAuthFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    private const ADMIN_USERNAME = 'test-admin';
    private const ADMIN_PASSWORD = 'admin-test-password-123';

    private function adminLogin(): string
    {
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson(
            '/api/admin/login',
            ['username' => self::ADMIN_USERNAME, 'password' => self::ADMIN_PASSWORD],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(200, $response->status, $response->body);

        return $this->fetchCsrfToken();
    }

    public function testUnauthenticatedAdminRoutesReturn401AndNeverAccountData(): void
    {
        $this->http->resetCookies();

        $me = $this->http->get('/api/admin/me');
        $this->assertSame(401, $me->status);
        $this->assertStringNotContainsString('@', $me->body);

        $users = $this->http->get('/api/admin/users');
        $this->assertSame(401, $users->status);

        $stats = $this->http->get('/api/admin/stats');
        $this->assertSame(401, $stats->status);
    }

    public function testWrongCredentialsAreRejected(): void
    {
        $csrf = $this->fetchCsrfToken();
        $wrongPassword = $this->http->postJson(
            '/api/admin/login',
            ['username' => self::ADMIN_USERNAME, 'password' => 'wrong-password'],
            ['X-CSRF-Token: ' . $csrf]
        );
        $this->assertSame(401, $wrongPassword->status);

        $this->http->resetCookies();
        $csrf2 = $this->fetchCsrfToken();
        $wrongUsername = $this->http->postJson(
            '/api/admin/login',
            ['username' => 'not-the-admin', 'password' => self::ADMIN_PASSWORD],
            ['X-CSRF-Token: ' . $csrf2]
        );
        $this->assertSame(401, $wrongUsername->status);

        // Identical error bodies regardless of which part was wrong (timing-safety mirror of
        // AuthController::login()'s unknown-email-vs-wrong-password behavior).
        $this->assertSame($wrongPassword->json(), $wrongUsername->json());
    }

    public function testCorrectCredentialsEstablishADistinctAdminSession(): void
    {
        $this->adminLogin();

        $me = $this->http->get('/api/admin/me');
        $this->assertSame(200, $me->status);
        $this->assertSame(self::ADMIN_USERNAME, $me->json()['username']);

        // An admin session cannot call regular user-scoped endpoints.
        $userMe = $this->http->get('/api/me');
        $this->assertSame(401, $userMe->status);
    }

    public function testRegularUserSessionCannotCallAdminEndpoints(): void
    {
        $this->registerAndLogin();

        $adminMe = $this->http->get('/api/admin/me');
        $this->assertSame(401, $adminMe->status);

        $adminUsers = $this->http->get('/api/admin/users');
        $this->assertSame(401, $adminUsers->status);
    }

    public function testLoggingInAsAdminEndsAnyPriorUserSessionIdentity(): void
    {
        [, $email, ] = $this->registerAndLogin();
        $this->assertSame(200, $this->http->get('/api/me')->status);

        $this->adminLogin();

        // One session is always exactly one identity — logging in as admin must not leave the
        // prior user identity usable.
        $this->assertSame(401, $this->http->get('/api/me')->status);
        $this->assertSame(200, $this->http->get('/api/admin/me')->status);
    }

    public function testLogoutRequiresCsrfAndEndsTheAdminSession(): void
    {
        $this->adminLogin();

        $noCsrf = $this->http->postJson('/api/admin/logout', []);
        $this->assertSame(403, $noCsrf->status);

        $csrf = $this->fetchCsrfToken();
        $logout = $this->http->postJson('/api/admin/logout', [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $logout->status);

        $this->assertSame(401, $this->http->get('/api/admin/me')->status);
    }

    public function testCsrfIsEnforcedOnEveryStateChangingAdminEndpoint(): void
    {
        [$userId, ] = $this->registerAndLoginPending();
        // Logging in as a regular user above replaced any session identity — start fresh as
        // admin for the actual assertions below.
        $this->http->resetCookies();
        $this->adminLogin();

        $activateNoCsrf = $this->http->postJson('/api/admin/users/' . $userId . '/activate', []);
        $this->assertSame(403, $activateNoCsrf->status);

        $settingsNoCsrf = $this->http->patchJson('/api/admin/settings', ['uploadsEnabled' => false]);
        $this->assertSame(403, $settingsNoCsrf->status);
    }

    public function testAdminNotConfiguredReturns503WhenAdminCredentialsAreMissing(): void
    {
        // A dedicated server instance with the admin config keys unset, simulating an
        // upgraded-but-not-yet-configured deploy.
        $server = new ServerProcess(['ADMIN_USERNAME' => '', 'ADMIN_PASSWORD_HASH' => '']);
        try {
            $http = new \Photomap\Backend\Tests\Support\HttpClient($server->baseUrl);
            $csrfResponse = $http->get('/api/csrf-token');
            $this->assertSame(200, $csrfResponse->status, 'Every other route must be unaffected by missing admin config.');
            $csrf = $csrfResponse->json()['csrfToken'];

            $login = $http->postJson('/api/admin/login', ['username' => 'x', 'password' => 'y'], ['X-CSRF-Token: ' . $csrf]);
            $this->assertSame(503, $login->status);
            $this->assertSame('admin_not_configured', $login->json()['error']);

            $users = $http->get('/api/admin/users');
            $this->assertSame(503, $users->status);
            $this->assertSame('admin_not_configured', $users->json()['error']);
        } finally {
            $server->stop();
        }
    }
}
