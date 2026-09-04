<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

final class FileValidator
{
    public const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

    /**
     * Detects the real content type of a file using its magic bytes (finfo), never trusting
     * the client-supplied MIME type or filename extension.
     */
    public function detectMimeType(string $path): ?string
    {
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        if ($finfo === false) {
            return null;
        }

        $mime = finfo_file($finfo, $path);
        finfo_close($finfo);

        return $mime === false ? null : $mime;
    }

    public function isAllowedMimeType(?string $mime): bool
    {
        return $mime !== null && in_array($mime, self::ALLOWED_MIME_TYPES, true);
    }
}
