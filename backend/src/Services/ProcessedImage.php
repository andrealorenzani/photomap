<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

/**
 * Result of ImageProcessor::process(). Paths are relative to the configured storage root
 * (e.g. "photos/3/ab12....jpg"), suitable for storing directly in the `photos` table.
 */
final class ProcessedImage
{
    public function __construct(
        public readonly string $storagePath,
        public readonly string $thumbnailPath,
        public readonly string $absoluteStoragePath,
        public readonly string $absoluteThumbnailPath,
        public readonly int $totalBytes
    ) {
    }
}
