<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

use PDO;
use PHPUnit\Framework\TestCase;
use Photomap\Backend\Config;
use Photomap\Backend\Database;

abstract class FeatureTestCase extends TestCase
{
    protected static ?ServerProcess $server = null;

    protected HttpClient $http;

    protected PDO $pdo;

    /**
     * Override in subclasses to customize the server's environment (e.g. a tiny quota).
     *
     * @return array<string, string>
     */
    protected static function envOverrides(): array
    {
        return [];
    }

    public static function setUpBeforeClass(): void
    {
        parent::setUpBeforeClass();
        static::$server = new ServerProcess(static::envOverrides());
    }

    public static function tearDownAfterClass(): void
    {
        static::$server?->stop();
        static::$server = null;
        parent::tearDownAfterClass();
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = new HttpClient(static::$server->baseUrl);
        $this->pdo = Database::connect();
        $this->resetDatabase();
        $this->resetStorage();
    }

    protected function resetDatabase(): void
    {
        $this->pdo->exec('SET FOREIGN_KEY_CHECKS=0');
        foreach (['photos', 'share_links', 'users', 'geocode_cache', 'login_attempts', 'registration_attempts'] as $table) {
            $this->pdo->exec("TRUNCATE TABLE {$table}");
        }
        $this->pdo->exec('UPDATE nominatim_rate_limit SET last_request_at = NULL WHERE id = 1');
        $this->pdo->exec(
            'UPDATE app_settings SET default_storage_quota_bytes = 104857600, uploads_enabled = 1 WHERE id = 1'
        );
        $this->pdo->exec('SET FOREIGN_KEY_CHECKS=1');
    }

    protected function resetStorage(): void
    {
        $storagePath = rtrim((string) Config::get('STORAGE_PATH'), '/');
        foreach (['photos', 'thumbnails'] as $sub) {
            $dir = $storagePath . '/' . $sub;
            self::removeDirectoryContents($dir);
        }
    }

    private static function removeDirectoryContents(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        $items = scandir($dir) ?: [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . '/' . $item;
            if (is_dir($path)) {
                self::removeDirectoryContents($path);
                @rmdir($path);
            } else {
                @unlink($path);
            }
        }
    }

    protected function fixturePath(string $name): string
    {
        return dirname(__DIR__) . '/fixtures/' . $name;
    }

    /**
     * Registers a user, activates the account directly against the DB (bypassing the admin
     * API — this is test setup, not the behavior under test), logs them in, and returns
     * [userId, email, csrfToken] with the HttpClient's cookie jar now holding a valid session.
     *
     * As of the admin-approval-gate release, a freshly-registered account is 'pending' and
     * cannot upload — every pre-existing test in this suite implicitly assumed "registered ==
     * can upload," so this shared helper activates by default to preserve that assumption for
     * the whole existing suite without touching every individual call site. Tests that need to
     * exercise the pending state itself use registerAndLoginPending() instead.
     *
     * @return array{0: int, 1: string, 2: string}
     */
    protected function registerAndLogin(?string $email = null, string $password = 'password123'): array
    {
        [$userId, $email] = $this->registerAndLoginPending($email, $password);
        $this->activateUser($userId);

        // Re-fetch a CSRF token: activation doesn't touch the session, but callers expect a
        // fresh token valid for the current cookie jar regardless.
        $csrf = $this->fetchCsrfToken();

        return [$userId, $email, $csrf];
    }

    /**
     * Same as registerAndLogin() but deliberately leaves the account in its freshly-registered
     * 'pending' state — for tests that exercise the approval-gate behavior itself.
     *
     * @return array{0: int, 1: string, 2: string}
     */
    protected function registerAndLoginPending(?string $email = null, string $password = 'password123'): array
    {
        $email ??= 'user' . bin2hex(random_bytes(4)) . '@example.com';

        $csrf = $this->fetchCsrfToken();
        $registerResponse = $this->http->postJson('/api/register', ['email' => $email, 'password' => $password], [
            'X-CSRF-Token: ' . $csrf,
        ]);
        if ($registerResponse->status !== 201) {
            throw new \RuntimeException('Registration failed in test helper: ' . $registerResponse->body);
        }

        $csrf = $this->fetchCsrfToken();
        $loginResponse = $this->http->postJson('/api/login', ['email' => $email, 'password' => $password], [
            'X-CSRF-Token: ' . $csrf,
        ]);
        if ($loginResponse->status !== 200) {
            throw new \RuntimeException('Login failed in test helper: ' . $loginResponse->body);
        }

        $userId = (int) $loginResponse->json()['id'];
        $csrf = $this->fetchCsrfToken();

        return [$userId, $email, $csrf];
    }

    /**
     * Direct-DB test helper (not the admin API under test) to flip a user to 'active', with an
     * optional per-user storage quota override.
     */
    protected function activateUser(int $userId, ?int $storageQuotaBytes = null): void
    {
        $stmt = $this->pdo->prepare(
            'UPDATE users SET status = ?, storage_quota_bytes = ?, approved_at = NOW() WHERE id = ?'
        );
        $stmt->execute(['active', $storageQuotaBytes, $userId]);
    }

    /**
     * Direct-DB test helper (not the admin API under test) to flip a user to 'disabled'.
     */
    protected function disableUser(int $userId): void
    {
        $stmt = $this->pdo->prepare('UPDATE users SET status = ? WHERE id = ?');
        $stmt->execute(['disabled', $userId]);
    }

    /**
     * Inserts a GPS-less photo row directly against the DB, bypassing the upload API
     * entirely — simulates a row that pre-dates the account-mode GPS-required enforcement
     * (which now rejects GPS-less uploads at the API), for regression-testing that PATCH
     * (assign-a-location-later) still works on such pre-existing rows.
     */
    protected function insertGpsLessPhotoForUser(int $userId): int
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO photos (user_id, storage_path, thumbnail_path, file_size_bytes, lat, lon, taken_at, camera_make, camera_model)
             VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)'
        );
        $suffix = bin2hex(random_bytes(8));
        $stmt->execute([
            $userId,
            "photos/{$userId}/{$suffix}.jpg",
            "thumbnails/{$userId}/{$suffix}.jpg",
            100,
        ]);

        return (int) $this->pdo->lastInsertId();
    }

    protected function fetchCsrfToken(): string
    {
        $response = $this->http->get('/api/csrf-token');

        return (string) $response->json()['csrfToken'];
    }
}
