<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class AuthFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testRegistrationSucceedsAndStoresHashedPassword(): void
    {
        $email = 'newuser@example.com';
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], [
            'X-CSRF-Token: ' . $csrf,
        ]);

        $this->assertSame(201, $response->status);
        $body = $response->json();
        $this->assertSame($email, $body['email']);
        $this->assertIsInt($body['id']);

        $row = $this->pdo->query("SELECT password_hash FROM users WHERE email = " . $this->pdo->quote($email))->fetch();
        $this->assertStringStartsWith('$2y$', $row['password_hash']);
        $this->assertStringNotContainsString('password123', $response->body);
    }

    public function testDuplicateEmailReturns409AndDoesNotDuplicateRow(): void
    {
        $email = 'dupe@example.com';
        $csrf = $this->fetchCsrfToken();
        $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);

        $csrf2 = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', ['email' => $email, 'password' => 'anotherpass1'], ['X-CSRF-Token: ' . $csrf2]);

        $this->assertSame(409, $response->status);

        $count = (int) $this->pdo->query("SELECT COUNT(*) c FROM users WHERE email = " . $this->pdo->quote($email))->fetch()['c'];
        $this->assertSame(1, $count);
    }

    public function testMalformedEmailIsRejected(): void
    {
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', ['email' => 'not-an-email', 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
    }

    public function testShortPasswordIsRejected(): void
    {
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', ['email' => 'shortpw@example.com', 'password' => 'short'], ['X-CSRF-Token: ' . $csrf]);

        $this->assertSame(422, $response->status);
    }

    public function testSqlMetacharacterPayloadIsHandledSafelyAsData(): void
    {
        $email = "weird+' OR '1'='1@example.com";
        $csrf = $this->fetchCsrfToken();

        $response = $this->http->postJson('/api/register', ['email' => $email, 'password' => "' OR '1'='1"], ['X-CSRF-Token: ' . $csrf]);

        // Rejected for being an invalid email format, but must not error/crash or execute SQL.
        $this->assertSame(422, $response->status);

        $stmt = $this->pdo->query('SELECT COUNT(*) c FROM users');
        $this->assertIsArray($stmt->fetch());
    }

    public function testLoginSetsCookieAndCsrfToken(): void
    {
        [$userId, $email] = $this->registerAndLogin();

        $meCsrf = $this->fetchCsrfToken();
        $this->assertIsString($meCsrf);

        $me = $this->http->get('/api/me');
        $this->assertSame(200, $me->status);
        $this->assertSame($email, $me->json()['email']);
    }

    public function testWrongPasswordAndUnknownEmailGiveIdenticalErrorBody(): void
    {
        [$userId, $email] = $this->registerAndLoginWithoutLoggingIn();

        $csrf1 = $this->fetchCsrfToken();
        $wrongPasswordResponse = $this->http->postJson('/api/login', ['email' => $email, 'password' => 'wrongpassword'], ['X-CSRF-Token: ' . $csrf1]);

        $this->http->resetCookies();
        $csrf2 = $this->fetchCsrfToken();
        $unknownEmailResponse = $this->http->postJson('/api/login', ['email' => 'doesnotexist@example.com', 'password' => 'whatever123'], ['X-CSRF-Token: ' . $csrf2]);

        $this->assertSame(401, $wrongPasswordResponse->status);
        $this->assertSame(401, $unknownEmailResponse->status);
        $this->assertSame($wrongPasswordResponse->json(), $unknownEmailResponse->json());
    }

    public function testSessionIdChangesAfterLogin(): void
    {
        $before = $this->fetchCsrfToken();
        $preLoginResponse = $this->http->get('/api/csrf-token');
        $preLoginCookie = $this->extractSessionCookieValue($preLoginResponse->setCookieHeaders());

        $email = 'sessid@example.com';
        $csrf = $this->fetchCsrfToken();
        $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);
        $csrf2 = $this->fetchCsrfToken();
        $loginResponse = $this->http->postJson('/api/login', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf2]);
        $postLoginCookie = $this->extractSessionCookieValue($loginResponse->setCookieHeaders());

        $this->assertSame(200, $loginResponse->status);
        $this->assertNotNull($postLoginCookie);
        $this->assertNotSame($preLoginCookie, $postLoginCookie);
    }

    public function testSuccessfulLoginResetsFailedAttemptCounter(): void
    {
        $email = 'resetcounter@example.com';
        $csrf = $this->fetchCsrfToken();
        $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);

        // One failure (below the 3-attempt threshold from .env.test).
        $csrf2 = $this->fetchCsrfToken();
        $this->http->postJson('/api/login', ['email' => $email, 'password' => 'wrongpassword'], ['X-CSRF-Token: ' . $csrf2]);

        // Correct login succeeds.
        $csrf3 = $this->fetchCsrfToken();
        $success = $this->http->postJson('/api/login', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf3]);
        $this->assertSame(200, $success->status);
    }

    public function testLogoutInvalidatesSessionAndRequiresCsrf(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $noCsrf = $this->http->postJson('/api/logout', []);
        $this->assertSame(403, $noCsrf->status);

        $logout = $this->http->postJson('/api/logout', [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $logout->status);

        $meAfter = $this->http->get('/api/me');
        $this->assertSame(401, $meAfter->status);
    }

    public function testMeReturns401BeforeLoginThenUserThenLogoutIs401Again(): void
    {
        $this->http->resetCookies();
        $before = $this->http->get('/api/me');
        $this->assertSame(401, $before->status);

        [$userId, $email, $csrf] = $this->registerAndLogin();
        $during = $this->http->get('/api/me');
        $this->assertSame(200, $during->status);
        $this->assertSame($email, $during->json()['email']);

        $this->http->postJson('/api/logout', [], ['X-CSRF-Token: ' . $csrf]);
        $after = $this->http->get('/api/me');
        $this->assertSame(401, $after->status);
    }

    private function extractSessionCookieValue(array $setCookieHeaders): ?string
    {
        foreach ($setCookieHeaders as $header) {
            if (str_starts_with($header, 'photomap_session_test=')) {
                return explode(';', $header)[0];
            }
        }

        return null;
    }

    /**
     * @return array{0: int, 1: string}
     */
    private function registerAndLoginWithoutLoggingIn(): array
    {
        $email = 'noone' . bin2hex(random_bytes(4)) . '@example.com';
        $csrf = $this->fetchCsrfToken();
        $response = $this->http->postJson('/api/register', ['email' => $email, 'password' => 'password123'], ['X-CSRF-Token: ' . $csrf]);

        return [(int) $response->json()['id'], $email];
    }
}
