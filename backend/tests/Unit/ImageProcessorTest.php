<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Services\ImageProcessor;

final class ImageProcessorTest extends TestCase
{
    private string $storagePath;

    protected function setUp(): void
    {
        $this->storagePath = sys_get_temp_dir() . '/photomap-imgproc-' . bin2hex(random_bytes(6));
        mkdir($this->storagePath . '/photos', 0775, true);
        mkdir($this->storagePath . '/thumbnails', 0775, true);
    }

    protected function tearDown(): void
    {
        $this->removeDir($this->storagePath);
    }

    private function removeDir(string $dir): void
    {
        if (!is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir . '/' . $item;
            is_dir($path) ? $this->removeDir($path) : unlink($path);
        }
        rmdir($dir);
    }

    private function fixture(string $name): string
    {
        return dirname(__DIR__) . '/fixtures/' . $name;
    }

    public function testLargeJpegIsResizedDownToMaxLongEdge(): void
    {
        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('large-2400x1600.jpg'), 'image/jpeg', 1);

        [$width, $height] = getimagesize($result->absoluteStoragePath);
        $this->assertLessThanOrEqual(2000, max($width, $height));

        // Aspect ratio preserved (2400x1600 = 1.5).
        $this->assertEqualsWithDelta(1.5, $width / $height, 0.01);
    }

    public function testSmallJpegIsNotUpscaled(): void
    {
        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('small-800x600.jpg'), 'image/jpeg', 1);

        [$width, $height] = getimagesize($result->absoluteStoragePath);
        $this->assertSame(800, $width);
        $this->assertSame(600, $height);
    }

    public function testThumbnailLongEdgeIsAtMost320(): void
    {
        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('large-2400x1600.jpg'), 'image/jpeg', 1);

        [$width, $height] = getimagesize($result->absoluteThumbnailPath);
        $this->assertLessThanOrEqual(320, max($width, $height));
    }

    public function testPngWithAlphaIsFlattenedAndNormalizedToJpeg(): void
    {
        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('with-alpha.png'), 'image/png', 1);

        $this->assertStringEndsWith('.jpg', $result->storagePath);
        $mime = mime_content_type($result->absoluteStoragePath);
        $this->assertSame('image/jpeg', $mime);
    }

    public function testCorruptedImageThrowsAndLeavesNoOrphanedFiles(): void
    {
        $processor = new ImageProcessor($this->storagePath);

        $this->expectException(\RuntimeException::class);
        $processor->process($this->fixture('corrupted.jpg'), 'image/jpeg', 1);
    }

    public function testStoredFilenameIsServerGeneratedNotClientControlled(): void
    {
        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('small-800x600.jpg'), 'image/jpeg', 1);

        $this->assertMatchesRegularExpression('#photos/1/[0-9a-f]{32}\.jpg#', $result->storagePath);
        $this->assertMatchesRegularExpression('#thumbnails/1/[0-9a-f]{32}\.jpg#', $result->thumbnailPath);
    }

    public function testWebpProcessesNormallyWhenSupported(): void
    {
        if (!ImageProcessor::isWebpSupported()) {
            $this->markTestSkipped('GD in this environment does not support WebP.');
        }

        $processor = new ImageProcessor($this->storagePath);
        $result = $processor->process($this->fixture('small.webp'), 'image/webp', 1);

        $this->assertFileExists($result->absoluteStoragePath);
        $this->assertFileExists($result->absoluteThumbnailPath);
    }
}
