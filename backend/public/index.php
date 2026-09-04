<?php

declare(strict_types=1);

require_once __DIR__ . '/../vendor/autoload.php';

use Photomap\Backend\Bootstrap;
use Photomap\Backend\Config;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Middleware\CorsMiddleware;
use Photomap\Backend\Session;

$root = dirname(__DIR__);

Config::load($root);

$request = Request::fromGlobals();

// CORS runs before the session starts and before routing: a preflight OPTIONS request needs
// neither, and must be answered even for routes that never registered an OPTIONS handler.
// CORS_ALLOWED_ORIGINS defaults to empty (no CORS headers emitted at all), which is correct for
// the same-origin dev-proxy and Docker deployment paths.
$allowedOrigins = array_values(array_filter(array_map(
    'trim',
    explode(',', (string) Config::get('CORS_ALLOWED_ORIGINS', ''))
)));
$corsResponse = (new CorsMiddleware($allowedOrigins))->handle($request);
if ($corsResponse !== null) {
    $corsResponse->send();
    exit;
}

Session::start();

try {
    $router = Bootstrap::createRouter();
    $response = $router->dispatch($request);
} catch (Throwable $e) {
    error_log($e->getMessage() . "\n" . $e->getTraceAsString());
    $response = JsonResponse::error('internal_error', 'An unexpected error occurred.', 500);
}

$response->send();
