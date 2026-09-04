<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

final class ImageProcessor
{
    private const MAIN_LONG_EDGE = 2000;
    private const MAIN_QUALITY = 85;
    private const THUMB_LONG_EDGE = 320;
    private const THUMB_QUALITY = 80;

    public function __construct(private readonly string $storagePath)
    {
    }

    public static function isWebpSupported(): bool
    {
        return function_exists('imagecreatefromwebp') && function_exists('imagewebp');
    }

    /**
     * @throws \RuntimeException on decode failure (e.g. corrupted image)
     */
    public function process(string $sourcePath, string $mimeType, int $userId): ProcessedImage
    {
        $image = $this->readImage($sourcePath, $mimeType);

        $image = $this->applyExifOrientation($image, $sourcePath, $mimeType);

        $main = $this->resize($image, self::MAIN_LONG_EDGE);
        $thumb = $this->resize($image, self::THUMB_LONG_EDGE);

        $userDirPhotos = $this->storagePath . '/photos/' . $userId;
        $userDirThumbs = $this->storagePath . '/thumbnails/' . $userId;
        $this->ensureDir($userDirPhotos);
        $this->ensureDir($userDirThumbs);

        $filename = bin2hex(random_bytes(16)) . '.jpg';

        $absStorage = $userDirPhotos . '/' . $filename;
        $absThumb = $userDirThumbs . '/' . $filename;

        if (!imagejpeg($main, $absStorage, self::MAIN_QUALITY)) {
            imagedestroy($image);
            imagedestroy($main);
            imagedestroy($thumb);
            throw new \RuntimeException('Failed to write resized image.');
        }

        if (!imagejpeg($thumb, $absThumb, self::THUMB_QUALITY)) {
            @unlink($absStorage);
            imagedestroy($image);
            imagedestroy($main);
            imagedestroy($thumb);
            throw new \RuntimeException('Failed to write thumbnail image.');
        }

        imagedestroy($image);
        imagedestroy($main);
        imagedestroy($thumb);

        $totalBytes = (filesize($absStorage) ?: 0) + (filesize($absThumb) ?: 0);

        return new ProcessedImage(
            storagePath: 'photos/' . $userId . '/' . $filename,
            thumbnailPath: 'thumbnails/' . $userId . '/' . $filename,
            absoluteStoragePath: $absStorage,
            absoluteThumbnailPath: $absThumb,
            totalBytes: $totalBytes
        );
    }

    /**
     * @return \GdImage
     */
    private function readImage(string $path, string $mimeType)
    {
        $image = match ($mimeType) {
            'image/jpeg' => @imagecreatefromjpeg($path),
            'image/png' => @imagecreatefrompng($path),
            'image/webp' => self::isWebpSupported() ? @imagecreatefromwebp($path) : false,
            default => false,
        };

        if ($image === false) {
            throw new \RuntimeException('Could not decode image (corrupted or unsupported).');
        }

        // Flatten any alpha channel (PNG transparency) onto a white background; output is
        // always normalized to JPEG which has no alpha support.
        if ($mimeType === 'image/png' || $mimeType === 'image/webp') {
            $width = imagesx($image);
            $height = imagesy($image);
            $flattened = imagecreatetruecolor($width, $height);
            $white = imagecolorallocate($flattened, 255, 255, 255);
            imagefill($flattened, 0, 0, $white);
            imagealphablending($flattened, true);
            imagecopy($flattened, $image, 0, 0, 0, 0, $width, $height);
            imagedestroy($image);
            $image = $flattened;
        }

        return $image;
    }

    /**
     * @param \GdImage $image
     * @return \GdImage
     */
    private function applyExifOrientation($image, string $sourcePath, string $mimeType)
    {
        if ($mimeType !== 'image/jpeg' || !function_exists('exif_read_data')) {
            return $image;
        }

        $exif = @exif_read_data($sourcePath);
        if ($exif === false || !isset($exif['Orientation'])) {
            return $image;
        }

        $orientation = (int) $exif['Orientation'];

        $rotated = match ($orientation) {
            3 => imagerotate($image, 180, 0),
            6 => imagerotate($image, -90, 0),
            8 => imagerotate($image, 90, 0),
            default => $image,
        };

        if ($rotated !== $image && $rotated !== false) {
            imagedestroy($image);

            return $rotated;
        }

        return $image;
    }

    /**
     * @param \GdImage $image
     * @return \GdImage
     */
    private function resize($image, int $maxLongEdge)
    {
        $width = imagesx($image);
        $height = imagesy($image);
        $longEdge = max($width, $height);

        if ($longEdge <= $maxLongEdge) {
            // Never upscale — copy as-is.
            $copy = imagecreatetruecolor($width, $height);
            imagecopy($copy, $image, 0, 0, 0, 0, $width, $height);

            return $copy;
        }

        $scale = $maxLongEdge / $longEdge;
        $newWidth = max(1, (int) round($width * $scale));
        $newHeight = max(1, (int) round($height * $scale));

        $resized = imagecreatetruecolor($newWidth, $newHeight);
        imagecopyresampled($resized, $image, 0, 0, 0, 0, $newWidth, $newHeight, $width, $height);

        return $resized;
    }

    private function ensureDir(string $dir): void
    {
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
    }
}
