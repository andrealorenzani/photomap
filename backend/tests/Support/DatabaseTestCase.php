<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

use PDO;
use PHPUnit\Framework\TestCase;
use Photomap\Backend\Database;

abstract class DatabaseTestCase extends TestCase
{
    protected PDO $pdo;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pdo = Database::connect();
        $this->resetDatabase();
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

    protected function fixturePath(string $name): string
    {
        return dirname(__DIR__) . '/fixtures/' . $name;
    }

    protected function scratchStoragePath(): string
    {
        return rtrim((string) \Photomap\Backend\Config::get('STORAGE_PATH'), '/');
    }
}
