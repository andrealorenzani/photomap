<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * .env.test sets RATE_LIMIT_LOGIN_MAX_ATTEMPTS=3 and RATE_LIMIT_LOGIN_WINDOW_SECONDS=2, so
 * this suite doesn't need real multi-second sleeps except the one deliberate window-expiry
 * assertion below.
 */
final class RateLimitFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    private function login(string $email, string $password): \Photomap\Backend\Tests\Support\HttpResponse
    {
        $csrf = $this->fetchCsrfToken();

        return $this->http->postJson('/api/login', ['email' => $email, 'password' => $password], ['X-CSRF-Token: ' . $csrf]);
    }

    public function testAlmostMaxFailuresThenCorrectPasswordSucceeds(): void
    {
        [, $email] = $this->registerAndLogin();
        $this->http->resetCookies();

        // Max attempts is 3; 2 failures should not yet block.
        $this->login($email, 'wrongpassword');
        $this->login($email, 'wrongpassword');

        $success = $this->login($email, 'password123');
        $this->assertSame(200, $success->status);
    }

    public function testNthFailureBlocksEvenCorrectPasswordUntilWindowElapses(): void
    {
        [, $email] = $this->registerAndLogin();
        $this->http->resetCookies();

        $this->login($email, 'wrongpassword');
        $this->login($email, 'wrongpassword');
        $this->login($email, 'wrongpassword');

        $blockedEvenCorrect = $this->login($email, 'password123');
        $this->assertSame(429, $blockedEvenCorrect->status);

        sleep(3); // RATE_LIMIT_LOGIN_WINDOW_SECONDS=2 in .env.test

        $afterWindow = $this->login($email, 'password123');
        $this->assertSame(200, $afterWindow->status);
    }

    public function testPerIpLimiterTripsAcrossDifferentEmailsFromSameIp(): void
    {
        $emailA = 'ratelimita' . bin2hex(random_bytes(4)) . '@example.com';
        $emailB = 'ratelimitb' . bin2hex(random_bytes(4)) . '@example.com';

        $csrf = $this->fetchCsrfToken();
        $this->http->postJson('/api/register', ['email' => $emailA, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);
        $csrf2 = $this->fetchCsrfToken();
        $this->http->postJson('/api/register', ['email' => $emailB, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf2]);

        // All from the same client (same IP): 3 failures against email A trips the IP limiter.
        $this->login($emailA, 'wrongpassword');
        $this->login($emailA, 'wrongpassword');
        $this->login($emailA, 'wrongpassword');

        // Email B has zero failures of its own, but shares the IP, so it's blocked too.
        $blocked = $this->login($emailB, 'password123');
        $this->assertSame(429, $blocked->status);
    }
}
