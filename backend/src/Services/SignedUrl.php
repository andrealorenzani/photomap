<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

final class SignedUrl
{
    public const VARIANT_FILE = 'file';
    public const VARIANT_THUMBNAIL = 'thumbnail';

    public const OWNER_TTL_SECONDS = 15 * 60;
    public const SHARE_TTL_SECONDS = 10 * 60;

    public function __construct(private readonly string $secret)
    {
    }

    public function buildOwnerUrl(int $photoId, string $variant): string
    {
        $expires = time() + self::OWNER_TTL_SECONDS;
        $sig = $this->signOwner($photoId, $variant, $expires);

        $path = $this->endpointPath($photoId, $variant);

        return $path . '?ctx=owner&expires=' . $expires . '&sig=' . urlencode($sig);
    }

    public function buildShareUrl(string $shareToken, int $photoId, string $variant): string
    {
        $expires = time() + self::SHARE_TTL_SECONDS;
        $sig = $this->signShare($shareToken, $photoId, $variant, $expires);

        $path = $this->endpointPath($photoId, $variant);

        return $path . '?ctx=share&expires=' . $expires . '&sig=' . urlencode($sig)
            . '&share_token=' . urlencode($shareToken);
    }

    public function signOwner(int $photoId, string $variant, int $expires): string
    {
        return hash_hmac('sha256', "owner|{$photoId}|{$variant}|{$expires}", $this->secret);
    }

    public function signShare(string $shareToken, int $photoId, string $variant, int $expires): string
    {
        return hash_hmac('sha256', "share|{$shareToken}|{$photoId}|{$variant}|{$expires}", $this->secret);
    }

    public function verifyOwner(int $photoId, string $variant, int $expires, string $sig): bool
    {
        if ($expires <= time()) {
            return false;
        }

        $expected = $this->signOwner($photoId, $variant, $expires);

        return hash_equals($expected, $sig);
    }

    public function verifyShare(string $shareToken, int $photoId, string $variant, int $expires, string $sig): bool
    {
        if ($expires <= time()) {
            return false;
        }

        $expected = $this->signShare($shareToken, $photoId, $variant, $expires);

        return hash_equals($expected, $sig);
    }

    private function endpointPath(int $photoId, string $variant): string
    {
        return "/api/photos/{$photoId}/{$variant}";
    }
}
