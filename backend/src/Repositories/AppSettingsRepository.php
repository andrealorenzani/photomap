<?php

declare(strict_types=1);

namespace Photomap\Backend\Repositories;

use PDO;

/**
 * Wraps the single-sentinel-row `app_settings` table (same pattern already used by
 * `nominatim_rate_limit`) — product-level, admin-editable settings that must take effect
 * without a redeploy, unlike config.php's deploy-time infrastructure values.
 */
final class AppSettingsRepository
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * @return array{default_storage_quota_bytes: int, uploads_enabled: bool, updated_at: string}
     */
    public function get(): array
    {
        $stmt = $this->pdo->query(
            'SELECT default_storage_quota_bytes, uploads_enabled, updated_at FROM app_settings WHERE id = 1'
        );
        $row = $stmt->fetch();

        if ($row === false) {
            // Defensive fallback only — the 0008 migration always inserts the sentinel row.
            // A missing row here means migrations haven't been fully applied, which is a
            // deploy-time problem orthogonal to the "admin config keys absent" boot-time
            // tolerance this release otherwise guarantees.
            return ['default_storage_quota_bytes' => 104857600, 'uploads_enabled' => true, 'updated_at' => ''];
        }

        return [
            'default_storage_quota_bytes' => (int) $row['default_storage_quota_bytes'],
            'uploads_enabled' => (bool) $row['uploads_enabled'],
            'updated_at' => (string) $row['updated_at'],
        ];
    }

    public function update(?int $defaultStorageQuotaBytes, ?bool $uploadsEnabled): void
    {
        $current = $this->get();
        $newQuota = $defaultStorageQuotaBytes ?? $current['default_storage_quota_bytes'];
        $newEnabled = $uploadsEnabled ?? $current['uploads_enabled'];

        $stmt = $this->pdo->prepare(
            'UPDATE app_settings SET default_storage_quota_bytes = ?, uploads_enabled = ? WHERE id = 1'
        );
        $stmt->execute([$newQuota, $newEnabled ? 1 : 0]);
    }
}
