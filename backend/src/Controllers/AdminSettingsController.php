<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Services\AppSettingsService;

final class AdminSettingsController
{
    public function __construct(private readonly AppSettingsService $settings)
    {
    }

    public function show(Request $request): JsonResponse
    {
        return new JsonResponse($this->settings->getSettings());
    }

    public function update(Request $request): JsonResponse
    {
        $body = $request->json();

        $quotaBytes = null;
        if (array_key_exists('defaultStorageQuotaBytes', $body) && $body['defaultStorageQuotaBytes'] !== null) {
            $raw = $body['defaultStorageQuotaBytes'];
            if (!is_numeric($raw) || (int) $raw <= 0) {
                return JsonResponse::error(
                    'invalid_settings',
                    'defaultStorageQuotaBytes must be a positive number.',
                    422
                );
            }
            $quotaBytes = (int) $raw;
        }

        $uploadsEnabled = null;
        if (array_key_exists('uploadsEnabled', $body) && $body['uploadsEnabled'] !== null) {
            if (!is_bool($body['uploadsEnabled'])) {
                return JsonResponse::error('invalid_settings', 'uploadsEnabled must be a boolean.', 422);
            }
            $uploadsEnabled = $body['uploadsEnabled'];
        }

        $updated = $this->settings->updateSettings($quotaBytes, $uploadsEnabled);

        return new JsonResponse($updated);
    }
}
