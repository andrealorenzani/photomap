<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

use Photomap\Backend\Repositories\LoginAttemptRepository;

final class RateLimiter
{
    public function __construct(
        private readonly LoginAttemptRepository $attempts,
        private readonly int $maxAttempts,
        private readonly int $windowSeconds
    ) {
    }

    /**
     * Returns true if the given email or IP has hit the failure threshold within the window,
     * meaning the login attempt should be blocked before password_verify() is even attempted.
     */
    public function isBlocked(string $email, string $ip): bool
    {
        $byEmail = $this->attempts->countRecentFailuresByEmail($email, $this->windowSeconds);
        if ($byEmail >= $this->maxAttempts) {
            return true;
        }

        $byIp = $this->attempts->countRecentFailuresByIp($ip, $this->windowSeconds);

        return $byIp >= $this->maxAttempts;
    }

    public function recordAttempt(string $email, string $ip, bool $succeeded): void
    {
        $this->attempts->record($email, $ip, $succeeded);
    }
}
