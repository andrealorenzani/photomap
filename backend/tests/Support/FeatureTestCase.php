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
        foreach (['photos', 'share_links', 'users', 'geocode_cache', 'login_attempts'] as $table) {
            $this->pdo->exec("TRUNCATE TABLE {$table}");
        }
        $this->pdo->exec('UPDATE nominatim_rate_limit SET last_request_at = NULL WHERE id = 1');
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
     * Registers a user, logs them in, and returns [userId, email, csrfToken] with the
     * HttpClient's cookie jar now holding a valid session for that user.
     *
     * @return array{0: int, 1: string, 2: string}
     */
    protected function registerAndLogin(?string $email = null, string $password = 'password123'): array
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

    protected function fetchCsrfToken(): string
    {
        $response = $this->http->get('/api/csrf-token');

        return (string) $response->json()['csrfToken'];
    }
}
