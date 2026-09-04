<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Services\NominatimRateLimiter;
use Photomap\Backend\Tests\Support\DatabaseTestCase;

final class NominatimRateLimiterTest extends DatabaseTestCase
{
    public function testFirstCallDoesNotWait(): void
    {
        $limiter = new NominatimRateLimiter($this->pdo, 0.3);

        $start = microtime(true);
        $limiter->throttle(fn () => 'result');
        $elapsed = microtime(true) - $start;

        $this->assertLessThan(0.2, $elapsed);
    }

    public function testTwoRapidCallsAreSpacedByConfiguredInterval(): void
    {
        $interval = 0.3;
        $limiter = new NominatimRateLimiter($this->pdo, $interval);

        $start = microtime(true);
        $limiter->throttle(fn () => 'first');
        $limiter->throttle(fn () => 'second');
        $elapsed = microtime(true) - $start;

        $this->assertGreaterThanOrEqual($interval, $elapsed);
    }

    public function testCallbackResultIsReturned(): void
    {
        $limiter = new NominatimRateLimiter($this->pdo, 0.05);

        $result = $limiter->throttle(fn () => 'the-value');

        $this->assertSame('the-value', $result);
    }
}
