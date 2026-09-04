<?php

declare(strict_types=1);

namespace Photomap\Backend;

use PDO;

final class Database
{
    private static ?PDO $connection = null;

    public static function connect(): PDO
    {
        if (self::$connection instanceof PDO) {
            return self::$connection;
        }

        $host = Config::require('DB_HOST');
        $port = Config::get('DB_PORT', '3306');
        $name = Config::require('DB_NAME');
        $user = Config::require('DB_USER');
        $password = Config::get('DB_PASSWORD', '');

        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";

        self::$connection = new PDO($dsn, $user, $password, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_EMULATE_PREPARES => false,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);

        return self::$connection;
    }

    /**
     * For tests that need to force a fresh connection (e.g. after changing env).
     */
    public static function reset(): void
    {
        self::$connection = null;
    }
}
