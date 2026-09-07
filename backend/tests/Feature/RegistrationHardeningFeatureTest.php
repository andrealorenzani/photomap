<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

/**
 * Covers the four-layer registration anti-spam stack added to AuthController::register():
 * honeypot, timing check, per-IP rate limit, and disposable-email-domain blocklist -- plus a
 * control case proving a normal legitimate registration is unaffected. Deliberately no
 * third-party CAPTCHA is implemented (see docs/architecture.md's Deep Dives for that decision).
 *
 * Runs against its own tightened env (see envOverrides()): a low per-IP rate-limit threshold
 * and a real (non-zero) minimum form-render time, since the shared .env.test defaults are
 * deliberately loosened so the rest of this suite's many incidental registrations (via
 * FeatureTestCase::registerAndLoginPending()) never trip these checks -- see .env.test's
 * comment for why.
 */
final class RegistrationHardeningFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    protected static function envOverrides(): array
    {
        return [
            'RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS' => '3',
            'RATE_LIMIT_REGISTRATION_WINDOW_SECONDS' => '2',
            'REGISTRATION_MIN_FORM_SECONDS' => '2',
        ];
    }

    private function nowMillis(): int
    {
        return (int) round(microtime(true) * 1000);
    }

    /** A formRenderedAt comfortably older than the 2-second threshold, for calls not testing timing itself. */
    private function safeFormRenderedAt(): int
    {
        return $this->nowMillis() - 5000;
    }

    public function testControlCaseLegitimateRegistrationStillSucceeds(): void
    {
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', [
            'email' => 'legituser@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(201, $response->status);
        $body = $response->json();
        $this->assertSame('legituser@example.com', $body['email']);
        $this->assertSame('pending', $body['status']);

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'legituser@example.com'")->fetch();
        $this->assertNotFalse($row);
    }

    public function testHoneypotFilledInRejectsWithoutCreatingAnAccount(): void
    {
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', [
            'email' => 'bot1@example.com',
            'password' => 'password123',
            'website' => 'https://spam.example',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
        $this->assertSame('bot_detected', $response->json()['error']);

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'bot1@example.com'")->fetch();
        $this->assertFalse($row);
    }

    public function testSubThresholdTimingRejectsWithoutCreatingAnAccount(): void
    {
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', [
            'email' => 'bot2@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->nowMillis(), // submitted "instantly" -- well under 2s
        ], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
        $this->assertSame('bot_detected', $response->json()['error']);

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'bot2@example.com'")->fetch();
        $this->assertFalse($row);
    }

    public function testMissingFormRenderedAtIsTreatedAsSubThresholdWhenTimingCheckIsEnabled(): void
    {
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', [
            'email' => 'bot3@example.com',
            'password' => 'password123',
        ], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
        $this->assertSame('bot_detected', $response->json()['error']);
    }

    public function testDisposableEmailDomainRejectsWithAClearMessage(): void
    {
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', [
            'email' => 'someone@mailinator.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
        $body = $response->json();
        $this->assertSame('disposable_email', $body['error']);
        $this->assertNotEmpty($body['message']);

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'someone@mailinator.com'")->fetch();
        $this->assertFalse($row);
    }

    public function testPerIpRateLimitTripsAfterMaxAttemptsThenResetsAfterTheWindowExpires(): void
    {
        // Max is 3 within a 2-second window (see envOverrides()). The first 3 legitimate
        // attempts (from distinct emails, same IP) must all succeed.
        for ($i = 1; $i <= 3; $i++) {
            $csrf = $this->fetchCsrfToken();
            $response = $this->http->postJson('/api/register', [
                'email' => "ratelimit{$i}@example.com",
                'password' => 'password123',
                'website' => '',
                'formRenderedAt' => $this->safeFormRenderedAt(),
            ], ['X-CSRF-Token: ' . $csrf]);
            $this->assertSame(201, $response->status, "attempt {$i} should succeed");
        }

        // The 4th attempt within the same window must be throttled.
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', [
            'email' => 'ratelimit4@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(429, $response->status);
        $this->assertSame('too_many_attempts', $response->json()['error']);

        $row = $this->pdo->query("SELECT * FROM users WHERE email = 'ratelimit4@example.com'")->fetch();
        $this->assertFalse($row);

        // After the 2-second window elapses, a fresh attempt succeeds again.
        sleep(3);
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', [
            'email' => 'ratelimit5@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $response->status);
    }

    public function testEveryRegistrationPostIsRecordedRegardlessOfOutcomeIncludingRejectedOnes(): void
    {
        // A honeypot-rejected attempt still counts toward the per-IP throttle -- 2 honeypot
        // rejections + 1 legitimate attempt should leave exactly 1 attempt of "budget" before
        // the max-3 threshold trips on the next one.
        for ($i = 1; $i <= 2; $i++) {
            $csrf = $this->fetchCsrfToken();
            $this->http->postJson('/api/register', [
                'email' => "botrecorded{$i}@example.com",
                'password' => 'password123',
                'website' => 'filled-in',
                'formRenderedAt' => $this->safeFormRenderedAt(),
            ], ['X-CSRF-Token: ' . $csrf]);
        }

        $csrf = $this->fetchCsrfToken();
        $legit = $this->http->postJson('/api/register', [
            'email' => 'legitafterbots@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $legit->status);

        // This is the 4th POST from this IP in the window (2 honeypot + 1 legit + this one) --
        // must now be throttled even though it's itself otherwise a legitimate request.
        $csrf = $this->fetchCsrfToken();
        $throttled = $this->http->postJson('/api/register', [
            'email' => 'legitthrottled@example.com',
            'password' => 'password123',
            'website' => '',
            'formRenderedAt' => $this->safeFormRenderedAt(),
        ], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(429, $throttled->status);
    }
}
