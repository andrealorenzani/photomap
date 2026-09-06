<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Config;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Session;

/**
 * Admin login/logout/me. The admin identity is a single hardcoded username/password pair
 * from config.php/.env (ADMIN_USERNAME, ADMIN_PASSWORD_HASH) — no `users` row backs it, and
 * it never coexists in the same session as a regular user identity (see login()).
 */
final class AdminAuthController
{
    // Sentinel identity the shared RateLimiter/LoginAttemptRepository is keyed by for admin
    // login attempts, reusing the existing per-string+per-IP throttling rather than building
    // new brute-force-protection infrastructure.
    private const SENTINEL_IDENTITY = '__admin__';

    // Fixed, valid bcrypt hash used for the dummy password_verify() call on a wrong admin
    // username, so response timing doesn't leak whether the username was correct.
    private const DUMMY_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

    public function __construct(private readonly RateLimiter $rateLimiter)
    {
    }

    public function login(Request $request): JsonResponse
    {
        $adminUsername = Config::get('ADMIN_USERNAME');
        $adminPasswordHash = Config::get('ADMIN_PASSWORD_HASH');

        if ($adminUsername === null || $adminPasswordHash === null) {
            return JsonResponse::error(
                'admin_not_configured',
                'The admin console is not configured on this server.',
                503
            );
        }

        $body = $request->json();
        $username = is_string($body['username'] ?? null) ? trim($body['username']) : '';
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $ip = $request->ip();

        if ($username === '' || $password === '') {
            return JsonResponse::error('invalid_credentials', 'Username and password are required.', 401);
        }

        if ($this->rateLimiter->isBlocked(self::SENTINEL_IDENTITY, $ip)) {
            return JsonResponse::error('too_many_attempts', 'Too many failed login attempts. Please try again later.', 429);
        }

        if (!hash_equals($adminUsername, $username)) {
            // Dummy verify so a wrong username takes a similar amount of time as a wrong
            // password against the real username, mirroring AuthController::login().
            password_verify($password, self::DUMMY_HASH);
            $this->rateLimiter->recordAttempt(self::SENTINEL_IDENTITY, $ip, false);

            return JsonResponse::error('invalid_credentials', 'Invalid username or password.', 401);
        }

        if (!password_verify($password, $adminPasswordHash)) {
            $this->rateLimiter->recordAttempt(self::SENTINEL_IDENTITY, $ip, false);

            return JsonResponse::error('invalid_credentials', 'Invalid username or password.', 401);
        }

        // Unlike a `users` row, config.php is a static, hand-edited deploy-time file this
        // process cannot safely rewrite at runtime — so, unlike AuthController::login()'s
        // password_needs_rehash() upgrade path, an outdated hash here is only surfaced via a
        // log line for the operator to act on manually (regenerate ADMIN_PASSWORD_HASH).
        if (self::hashNeedsRehash($adminPasswordHash)) {
            error_log('AdminAuthController: ADMIN_PASSWORD_HASH uses an outdated algorithm; regenerate it (see README).');
        }

        session_regenerate_id(true);
        // One session is always exactly one identity — never both admin and user.
        unset($_SESSION['user_id'], $_SESSION['email']);
        $_SESSION['admin'] = true;
        Session::regenerateCsrfToken();

        $this->rateLimiter->recordAttempt(self::SENTINEL_IDENTITY, $ip, true);

        return new JsonResponse(['username' => $adminUsername]);
    }

    public function logout(Request $request): JsonResponse
    {
        Session::destroy();

        return new JsonResponse(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        if (($_SESSION['admin'] ?? null) !== true) {
            return JsonResponse::error('unauthorized', 'Admin authentication required.', 401);
        }

        return new JsonResponse(['username' => Config::get('ADMIN_USERNAME')]);
    }

    public static function hashNeedsRehash(string $hash): bool
    {
        return password_needs_rehash($hash, PASSWORD_DEFAULT);
    }
}
