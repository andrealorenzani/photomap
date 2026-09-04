<?php

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use Photomap\Backend\Config;
use Photomap\Backend\Database;

$root = dirname(__DIR__);

Config::load($root);

$pdo = Database::connect();

$pdo->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
);

$appliedStmt = $pdo->query('SELECT filename FROM schema_migrations');
$applied = $appliedStmt->fetchAll(PDO::FETCH_COLUMN);

$migrationsDir = $root . '/migrations';
$files = glob($migrationsDir . '/*.sql') ?: [];
sort($files);

$appliedCount = 0;

foreach ($files as $file) {
    $filename = basename($file);
    if (in_array($filename, $applied, true)) {
        continue;
    }

    $sql = file_get_contents($file);
    if ($sql === false) {
        fwrite(STDERR, "Could not read migration file: {$filename}\n");
        exit(1);
    }

    echo "Applying migration: {$filename}\n";

    // Note: DDL statements in MySQL cause an implicit commit, so these migrations are not
    // run inside a PDO transaction (it would be a no-op protection anyway). Migration files
    // are expected to be small and reviewed before running against production.
    try {
        foreach (splitStatements($sql) as $statement) {
            if (trim($statement) === '') {
                continue;
            }
            $pdo->exec($statement);
        }

        $insert = $pdo->prepare('INSERT INTO schema_migrations (filename) VALUES (?)');
        $insert->execute([$filename]);

        $appliedCount++;
    } catch (Throwable $e) {
        fwrite(STDERR, "Migration {$filename} failed: {$e->getMessage()}\n");
        exit(1);
    }
}

if ($appliedCount === 0) {
    echo "No new migrations to apply.\n";
} else {
    echo "Applied {$appliedCount} migration(s).\n";
}

/**
 * Naive statement splitter — sufficient for our simple DDL/DML migration files
 * (no stored procedures, no semicolons inside string literals).
 *
 * @return string[]
 */
function splitStatements(string $sql): array
{
    // Strip full-line "--" comments first so a semicolon mentioned inside a comment can't
    // be mistaken for a statement terminator by this naive splitter.
    $withoutComments = preg_replace('/^\s*--.*$/m', '', $sql);

    return array_filter(array_map('trim', explode(';', $withoutComments)));
}
