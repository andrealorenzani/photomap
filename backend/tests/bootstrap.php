<?php

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use Photomap\Backend\Config;

$root = dirname(__DIR__);

Config::load($root, '.env.test');

$storagePath = rtrim((string) Config::get('STORAGE_PATH', $root . '/tests/storage-scratch'), '/');
foreach (['photos', 'thumbnails'] as $sub) {
    $dir = $storagePath . '/' . $sub;
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
}
