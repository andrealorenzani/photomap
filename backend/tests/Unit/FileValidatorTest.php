<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Services\FileValidator;

final class FileValidatorTest extends TestCase
{
    private FileValidator $validator;

    protected function setUp(): void
    {
        $this->validator = new FileValidator();
    }

    private function fixture(string $name): string
    {
        return dirname(__DIR__) . '/fixtures/' . $name;
    }

    public function testDetectsRealJpegByContent(): void
    {
        $mime = $this->validator->detectMimeType($this->fixture('small-800x600.jpg'));
        $this->assertSame('image/jpeg', $mime);
        $this->assertTrue($this->validator->isAllowedMimeType($mime));
    }

    public function testDetectsRealPngByContent(): void
    {
        $mime = $this->validator->detectMimeType($this->fixture('with-alpha.png'));
        $this->assertSame('image/png', $mime);
        $this->assertTrue($this->validator->isAllowedMimeType($mime));
    }

    public function testTextFileRenamedJpgIsNotAllowedDespiteExtension(): void
    {
        $path = $this->fixture('not-an-image.jpg');
        $mime = $this->validator->detectMimeType($path);

        $this->assertNotSame('image/jpeg', $mime);
        $this->assertFalse($this->validator->isAllowedMimeType($mime));
    }

    public function testUnsupportedMimeTypeIsRejected(): void
    {
        $this->assertFalse($this->validator->isAllowedMimeType('application/pdf'));
        $this->assertFalse($this->validator->isAllowedMimeType(null));
    }
}
