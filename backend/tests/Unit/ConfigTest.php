<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Config;
use Photomap\Backend\Database;

/**
 * Covers Config::load()'s config.php-vs-.env precedence logic (the shared-hosting/Dreamhost
 * deploy path adds config.php as an alternate, higher-priority settings source -- see
 * docs/plans.md). Each test builds its own scratch "root" directory with some combination of
 * config.php/.env present, so these scenarios don't depend on this repo's real backend/ root
 * ever having either file in a particular state.
 */
final class ConfigTest extends TestCase
{
    private const RELEVANT_KEYS = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'PHOTOMAP_TEST_UNDEFINED_KEY'];

    private string $scratchRoot;

    /**
     * Snapshot of $_ENV/getenv() for each relevant key, taken before this test clears anything.
     * Config::get() checks $_ENV first (see Config.php) -- our own bootstrap-loaded .env.test
     * values may live only in $_ENV (Dotenv's default adapters don't necessarily call putenv()),
     * so both must be snapshotted/restored, not just getenv().
     *
     * @var array<string, array{env: string|null, getenv: string|false}>
     */
    private array $envSnapshot = [];

    protected function setUp(): void
    {
        parent::setUp();

        foreach (self::RELEVANT_KEYS as $key) {
            $this->envSnapshot[$key] = [
                'env' => array_key_exists($key, $_ENV) ? (string) $_ENV[$key] : null,
                'getenv' => getenv($key),
            ];
        }

        $this->scratchRoot = sys_get_temp_dir() . '/photomap-config-test-' . bin2hex(random_bytes(8));
        mkdir($this->scratchRoot, 0775, true);

        Config::resetForTesting();

        // Dotenv's immutable loader (used for the .env path) never overwrites an already-set
        // env var, and Config::get() checks $_ENV before getenv() -- so each test needs a truly
        // clean slate for these keys, not just Config::$loaded reset, or scenarios would
        // silently keep reading whatever tests/bootstrap.php already loaded from .env.test.
        foreach (self::RELEVANT_KEYS as $key) {
            unset($_ENV[$key], $_SERVER[$key]);
            putenv($key);
        }
    }

    /**
     * The real value tests/bootstrap.php loaded from .env.test for $key, captured in setUp()
     * before this test class clears it. Used by the end-to-end Database::connect() test, which
     * needs real, working credentials rather than fake placeholder ones.
     */
    private function originalEnvValue(string $key, string $default = ''): string
    {
        $snapshot = $this->envSnapshot[$key] ?? ['env' => null, 'getenv' => false];
        if ($snapshot['env'] !== null) {
            return $snapshot['env'];
        }

        return $snapshot['getenv'] === false ? $default : (string) $snapshot['getenv'];
    }

    protected function tearDown(): void
    {
        $this->removeDirectory($this->scratchRoot);

        foreach ($this->envSnapshot as $key => $snapshot) {
            if ($snapshot['env'] !== null) {
                $_ENV[$key] = $snapshot['env'];
            } else {
                unset($_ENV[$key]);
            }

            if ($snapshot['getenv'] === false) {
                putenv($key);
            } else {
                putenv("{$key}={$snapshot['getenv']}");
            }
        }

        Config::resetForTesting();
        Database::reset();

        parent::tearDown();
    }

    private function removeDirectory(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . '/' . $item;
            is_dir($path) ? $this->removeDirectory($path) : unlink($path);
        }
        rmdir($dir);
    }

    private function writeConfigPhp(array $values): void
    {
        $export = var_export($values, true);
        file_put_contents($this->scratchRoot . '/config.php', "<?php\nreturn {$export};\n");
    }

    private function writeEnvFile(array $values, string $filename = '.env'): void
    {
        $lines = [];
        foreach ($values as $key => $value) {
            $lines[] = "{$key}={$value}";
        }
        file_put_contents($this->scratchRoot . '/' . $filename, implode("\n", $lines) . "\n");
    }

    public function testConfigPhpIsUsedWhenNoEnvPresent(): void
    {
        $this->writeConfigPhp(['DB_HOST' => 'config-host', 'DB_NAME' => 'config-db']);

        Config::load($this->scratchRoot);

        $this->assertSame('config-host', Config::get('DB_HOST'));
        $this->assertSame('config-db', Config::get('DB_NAME'));
    }

    public function testEnvIsUsedWhenNoConfigPhpPresentUnchangedRegressionBehavior(): void
    {
        $this->writeEnvFile(['DB_HOST' => 'env-host', 'DB_NAME' => 'env-db']);

        Config::load($this->scratchRoot);

        $this->assertSame('env-host', Config::get('DB_HOST'));
        $this->assertSame('env-db', Config::get('DB_NAME'));
    }

    public function testConfigPhpTakesPrecedenceWhenBothPresent(): void
    {
        $this->writeConfigPhp(['DB_HOST' => 'config-host-wins']);
        $this->writeEnvFile(['DB_HOST' => 'env-host-loses']);

        Config::load($this->scratchRoot);

        $this->assertSame('config-host-wins', Config::get('DB_HOST'));
    }

    public function testNeitherPresentFallsBackToDefaultsAndRequireThrows(): void
    {
        Config::load($this->scratchRoot);

        $this->assertSame('fallback', Config::get('PHOTOMAP_TEST_UNDEFINED_KEY', 'fallback'));

        $this->expectException(\RuntimeException::class);
        Config::require('PHOTOMAP_TEST_UNDEFINED_KEY');
    }

    public function testMalformedConfigPhpNotReturningArrayFailsLoudly(): void
    {
        file_put_contents($this->scratchRoot . '/config.php', "<?php\nreturn 'not-an-array';\n");

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessageMatches('/must return an array/');
        Config::load($this->scratchRoot);
    }

    public function testMalformedConfigPhpWithParseErrorFailsLoudly(): void
    {
        file_put_contents($this->scratchRoot . '/config.php', "<?php\nreturn [ this is not valid php \$\$\$\n");

        $this->expectException(\Throwable::class);
        Config::load($this->scratchRoot);
    }

    public function testDatabaseConnectPicksUpConfigPhpSourcedCredentialsEndToEnd(): void
    {
        // Snapshot the real DB_* values already loaded from .env.test by tests/bootstrap.php,
        // then re-supply exactly those same values via a scratch config.php instead, proving
        // Database::connect() (not just Config::get() in isolation) picks up config.php-sourced
        // settings correctly.
        $this->writeConfigPhp([
            'DB_HOST' => $this->originalEnvValue('DB_HOST'),
            'DB_PORT' => $this->originalEnvValue('DB_PORT', '3306'),
            'DB_NAME' => $this->originalEnvValue('DB_NAME'),
            'DB_USER' => $this->originalEnvValue('DB_USER'),
            'DB_PASSWORD' => $this->originalEnvValue('DB_PASSWORD', ''),
        ]);

        Config::load($this->scratchRoot);
        Database::reset();

        $pdo = Database::connect();
        $this->assertSame('1', (string) $pdo->query('SELECT 1')->fetchColumn());
    }
}
