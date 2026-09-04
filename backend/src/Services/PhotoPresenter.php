<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

final class PhotoPresenter
{
    public function __construct(private readonly SignedUrl $signedUrl)
    {
    }

    public function toOwnerJson(array $row): array
    {
        $id = (int) $row['id'];

        return $this->baseFields($row) + [
            'thumbnailUrl' => $this->signedUrl->buildOwnerUrl($id, SignedUrl::VARIANT_THUMBNAIL),
            'previewUrl' => $this->signedUrl->buildOwnerUrl($id, SignedUrl::VARIANT_FILE),
        ];
    }

    public function toShareJson(array $row, string $shareToken): array
    {
        $id = (int) $row['id'];

        return $this->baseFields($row) + [
            'thumbnailUrl' => $this->signedUrl->buildShareUrl($shareToken, $id, SignedUrl::VARIANT_THUMBNAIL),
            'previewUrl' => $this->signedUrl->buildShareUrl($shareToken, $id, SignedUrl::VARIANT_FILE),
        ];
    }

    private function baseFields(array $row): array
    {
        return [
            'id' => (int) $row['id'],
            'lat' => $row['lat'] !== null ? (float) $row['lat'] : null,
            'lon' => $row['lon'] !== null ? (float) $row['lon'] : null,
            'takenAt' => $row['taken_at'],
            'cameraMake' => $row['camera_make'],
            'cameraModel' => $row['camera_model'],
            'createdAt' => $row['created_at'],
        ];
    }
}
