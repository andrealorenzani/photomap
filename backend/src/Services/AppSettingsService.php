<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

use Photomap\Backend\Repositories\AppSettingsRepository;

/**
 * Typed accessors over AppSettingsRepository. Read fresh per request — this is a
 * personal-tool-scale app with a single settings row, so no caching layer is warranted.
 */
final class AppSettingsService
{
    public function __construct(private readonly AppSettingsRepository $repository)
    {
    }

    public function getDefaultQuotaBytes(): int
    {
        return $this->repository->get()['default_storage_quota_bytes'];
    }

    public function isUploadsGloballyEnabled(): bool
    {
        return $this->repository->get()['uploads_enabled'];
    }

    /**
     * @return array{defaultStorageQuotaBytes: int, uploadsEnabled: bool, updatedAt: string}
     */
    public function getSettings(): array
    {
        $settings = $this->repository->get();

        return [
            'defaultStorageQuotaBytes' => $settings['default_storage_quota_bytes'],
            'uploadsEnabled' => $settings['uploads_enabled'],
            'updatedAt' => $settings['updated_at'],
        ];
    }

    /**
     * @return array{defaultStorageQuotaBytes: int, uploadsEnabled: bool, updatedAt: string}
     */
    public function updateSettings(?int $defaultStorageQuotaBytes, ?bool $uploadsEnabled): array
    {
        $this->repository->update($defaultStorageQuotaBytes, $uploadsEnabled);

        return $this->getSettings();
    }
}
