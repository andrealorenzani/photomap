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

        // Shared-hosting (e.g. Dreamhost) deploy path: a hand-edited config.php returning an
        // associative array takes precedence over .env, when present. This lets a non-technical
        // deploy step be "edit one file" instead of requiring phpdotenv's .env parsing/format.
        // Purely additive: Docker and native/local dev never place a config.php next to .env, so
        // this branch is a no-op for those paths.
        $configPhpPath = $rootPath . '/config.php';
        if (file_exists($configPhpPath)) {
            $values = require $configPhpPath;
            if (!is_array($values)) {
                throw new \RuntimeException(
                    'config.php must return an array of settings, got ' . get_debug_type($values)
                );
            }

            foreach ($values as $key => $value) {
                $key = (string) $key;
                $value = (string) $value;
                $_ENV[$key] = $value;
                putenv("{$key}={$value}");
            }

            self::$loaded = true;
            return;
        }

        if (file_exists($rootPath . '/' . $envFile)) {
            $dotenv = Dotenv::createImmutable($rootPath, $envFile);
            $dotenv->load();
        }

        self::$loaded = true;
    }

    /**
     * Test-only: allows a single PHPUnit process to exercise multiple load() scenarios
     * (config.php vs .env precedence) rather than requiring @runInSeparateProcess everywhere.
     * Never called from production code paths (public/index.php, scripts/migrate.php).
     */
    public static function resetForTesting(): void
    {
        self::$loaded = false;
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
