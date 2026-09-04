<?php

declare(strict_types=1);

namespace Photomap\Backend;

use Dotenv\Dotenv;

final class Config
{
    private static bool $loaded = false;

    public static function load(string $rootPath, string $envFile = '.env'): void
    {
        if (self::$loaded) {
            return;
        }

        if (file_exists($rootPath . '/' . $envFile)) {
            $dotenv = Dotenv::createImmutable($rootPath, $envFile);
            $dotenv->load();
        }

        self::$loaded = true;
    }

    public static function get(string $key, ?string $default = null): ?string
    {
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);

        if ($value === false || $value === null || $value === '') {
            return $default;
        }

        return (string) $value;
    }

    public static function getInt(string $key, int $default): int
    {
        $value = self::get($key);
        if ($value === null) {
            return $default;
        }

        return (int) $value;
    }

    public static function isProduction(): bool
    {
        return self::get('APP_ENV', 'local') === 'production';
    }

    public static function require(string $key): string
    {
        $value = self::get($key);
        if ($value === null) {
            throw new \RuntimeException("Missing required config value: {$key}");
        }

        return $value;
    }
}
