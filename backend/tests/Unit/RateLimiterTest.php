<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Repositories\LoginAttemptRepository;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Tests\Support\DatabaseTestCase;

final class RateLimiterTest extends DatabaseTestCase
{
    public function testNotBlockedWithNoAttempts(): void
    {
        $limiter = new RateLimiter(new LoginAttemptRepository($this->pdo), 5, 900);

        $this->assertFalse($limiter->isBlocked('user@example.com', '1.2.3.4'));
    }

    public function testBlocksAfterMaxFailuresByEmail(): void
    {
        $repo = new LoginAttemptRepository($this->pdo);
        $limiter = new RateLimiter($repo, 3, 900);

        $repo->record('user@example.com', '1.2.3.4', false);
        $repo->record('user@example.com', '1.2.3.4', false);
        $this->assertFalse($limiter->isBlocked('user@example.com', '1.2.3.4'));

        $repo->record('user@example.com', '1.2.3.4', false);
        $this->assertTrue($limiter->isBlocked('user@example.com', '1.2.3.4'));
    }

    public function testSuccessfulAttemptDoesNotResetPastFailuresRetroactively(): void
    {
        // The counter looks at recent attempts in the window; a success doesn't delete prior
        // failure rows, but a fresh window (simulated here via a short window + sleep) should
        // exclude old failures. This test focuses on the "success doesn't itself count as a
        // failure" behavior.
        $repo = new LoginAttemptRepository($this->pdo);
        $limiter = new RateLimiter($repo, 2, 900);

        $repo->record('user@example.com', '1.2.3.4', false);
        $repo->record('user@example.com', '1.2.3.4', true);

        $this->assertFalse($limiter->isBlocked('user@example.com', '1.2.3.4'));
    }

    public function testPerIpLimiterTripsIndependentlyAcrossDifferentEmails(): void
    {
        $repo = new LoginAttemptRepository($this->pdo);
        $limiter = new RateLimiter($repo, 3, 900);

        $repo->record('alice@example.com', '9.9.9.9', false);
        $repo->record('bob@example.com', '9.9.9.9', false);
        $repo->record('carol@example.com', '9.9.9.9', false);

        // None of these three emails individually has 3 failures, but the shared IP does.
        $this->assertTrue($limiter->isBlocked('dave@example.com', '9.9.9.9'));
        $this->assertFalse($limiter->isBlocked('alice@example.com', '8.8.8.8'));
    }

    public function testWindowExpiryAllowsRetryAfterElapsedTime(): void
    {
        $repo = new LoginAttemptRepository($this->pdo);
        $limiter = new RateLimiter($repo, 1, 1); // 1 attempt allowed, 1 second window

        $repo->record('user@example.com', '1.2.3.4', false);
        $this->assertTrue($limiter->isBlocked('user@example.com', '1.2.3.4'));

        sleep(2);

        $this->assertFalse($limiter->isBlocked('user@example.com', '1.2.3.4'));
    }
}
