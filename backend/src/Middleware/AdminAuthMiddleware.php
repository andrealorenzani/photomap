<?php

declare(strict_types=1);

namespace Photomap\Backend\Middleware;

use Photomap\Backend\Config;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;

/**
 * A structural sibling of AuthMiddleware, not a variant of it: checks a distinct
 * $_SESSION['admin'] flag, never $_SESSION['user_id'] — an admin has no `users` row at all.
 *
 * Also tolerates an incompletely-configured deploy: if ADMIN_USERNAME/ADMIN_PASSWORD_HASH
 * are missing, every /api/admin/* route (this middleware protects all but login/logout)
 * fails cleanly with 503 admin_not_configured instead of leaking a 401 that implies the
 * feature exists but the caller's credentials are merely wrong.
 */
final class AdminAuthMiddleware
{
    public function __invoke(Request $request): ?Response
    {
        if (Config::get('ADMIN_USERNAME') === null || Config::get('ADMIN_PASSWORD_HASH') === null) {
            return JsonResponse::error(
                'admin_not_configured',
                'The admin console is not configured on this server.',
                503
            );
        }

        if (($_SESSION['admin'] ?? null) !== true) {
            return JsonResponse::error('unauthorized', 'Admin authentication required.', 401);
        }

        return null;
    }
}
