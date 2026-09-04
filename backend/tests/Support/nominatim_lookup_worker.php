<?php

declare(strict_types=1);

require_once __DIR__ . '/../../vendor/autoload.php';

use Photomap\Backend\Services\NominatimClient;

[$script, $baseUrl, $userAgent, $lat, $lon] = $argv;

$client = new NominatimClient($userAgent, 5, $baseUrl);
$result = $client->lookup((float) $lat, (float) $lon);

echo json_encode(['result' => $result]);
