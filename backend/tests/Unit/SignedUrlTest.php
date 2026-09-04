<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Services\SignedUrl;

final class SignedUrlTest extends TestCase
{
    private SignedUrl $signedUrl;

    protected function setUp(): void
    {
        $this->signedUrl = new SignedUrl('test-secret-key');
    }

    public function testOwnerUrlVerifiesWithMatchingSignature(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signOwner(42, SignedUrl::VARIANT_FILE, $expires);

        $this->assertTrue($this->signedUrl->verifyOwner(42, SignedUrl::VARIANT_FILE, $expires, $sig));
    }

    public function testOwnerUrlRejectsMismatchedPhotoId(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signOwner(42, SignedUrl::VARIANT_FILE, $expires);

        $this->assertFalse($this->signedUrl->verifyOwner(43, SignedUrl::VARIANT_FILE, $expires, $sig));
    }

    public function testOwnerUrlRejectsMismatchedVariant(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signOwner(42, SignedUrl::VARIANT_FILE, $expires);

        $this->assertFalse($this->signedUrl->verifyOwner(42, SignedUrl::VARIANT_THUMBNAIL, $expires, $sig));
    }

    public function testOwnerUrlRejectsExpiredSignature(): void
    {
        $expires = time() - 1;
        $sig = $this->signedUrl->signOwner(42, SignedUrl::VARIANT_FILE, $expires);

        $this->assertFalse($this->signedUrl->verifyOwner(42, SignedUrl::VARIANT_FILE, $expires, $sig));
    }

    public function testOwnerUrlRejectsTamperedSignature(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signOwner(42, SignedUrl::VARIANT_FILE, $expires);
        $tampered = substr($sig, 0, -1) . (($sig[-1] === 'a') ? 'b' : 'a');

        $this->assertFalse($this->signedUrl->verifyOwner(42, SignedUrl::VARIANT_FILE, $expires, $tampered));
    }

    public function testShareUrlVerifiesWithMatchingToken(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signShare('abc123', 42, SignedUrl::VARIANT_THUMBNAIL, $expires);

        $this->assertTrue($this->signedUrl->verifyShare('abc123', 42, SignedUrl::VARIANT_THUMBNAIL, $expires, $sig));
    }

    public function testShareUrlRejectsDifferentToken(): void
    {
        $expires = time() + 100;
        $sig = $this->signedUrl->signShare('abc123', 42, SignedUrl::VARIANT_THUMBNAIL, $expires);

        $this->assertFalse($this->signedUrl->verifyShare('xyz789', 42, SignedUrl::VARIANT_THUMBNAIL, $expires, $sig));
    }

    public function testBuildOwnerUrlProducesVerifiableUrl(): void
    {
        $url = $this->signedUrl->buildOwnerUrl(7, SignedUrl::VARIANT_FILE);

        $this->assertStringStartsWith('/api/photos/7/file?ctx=owner&', $url);

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertTrue($this->signedUrl->verifyOwner(7, SignedUrl::VARIANT_FILE, (int) $query['expires'], $query['sig']));
    }

    public function testOwnerAndShareTtlsDifferAsSpecified(): void
    {
        $this->assertSame(15 * 60, SignedUrl::OWNER_TTL_SECONDS);
        $this->assertSame(10 * 60, SignedUrl::SHARE_TTL_SECONDS);
        $this->assertLessThan(SignedUrl::OWNER_TTL_SECONDS, SignedUrl::SHARE_TTL_SECONDS);
    }
}
