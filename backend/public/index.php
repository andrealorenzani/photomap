<?php

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use Photomap\Backend\Bootstrap;
use Photomap\Backend\Config;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Session;

$root = dirname(__DIR__);

Config::load($root);
Session::start();

$request = Request::fromGlobals();

try {
    $router = Bootstrap::createRouter();
    $response = $router->dispatch($request);
} catch (Throwable $e) {
    error_log($e->getMessage() . "\n" . $e->getTraceAsString());
    $response = JsonResponse::error('internal_error', 'An unexpected error occurred.', 500);
}

$response->send();
