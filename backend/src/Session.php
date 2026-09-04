<?php

declare(strict_types=1);

namespace Photomap\Backend;

final class Session
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }

        $cookieName = Config::get('SESSION_COOKIE_NAME', 'photomap_session');
        session_name($cookieName);

        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'domain' => '',
            // Secure only when APP_ENV=production. Plain-HTTP `php -S` dev/test cannot
            // receive Secure cookies at all, so this is a documented dev-only exception.
            'secure' => Config::isProduction(),
            'httponly' => true,
            // Configurable for a genuinely split-origin deployment (see CorsMiddleware):
            // cross-site fetch() calls don't send SameSite=Lax cookies at all, so a
            // split-origin production deployment needs SameSite=None (only usable over HTTPS,
            // i.e. also requires APP_ENV=production so Secure is set). Same-origin deployments
            // (dev proxy, Docker) never need to change this from the Lax default.
            'samesite' => Config::get('SESSION_COOKIE_SAMESITE', 'Lax'),
        ]);

        session_start();

        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }
    }

    public static function regenerateCsrfToken(): string
    {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));

        return $_SESSION['csrf_token'];
    }

    public static function destroy(): void
    {
        $_SESSION = [];

        if (session_status() === PHP_SESSION_ACTIVE) {
            $params = session_get_cookie_params();
            setcookie(
                session_name(),
                '',
                time() - 42000,
                $params['path'],
                $params['domain'],
                $params['secure'],
                $params['httponly']
            );
            session_destroy();
        }
    }
}
