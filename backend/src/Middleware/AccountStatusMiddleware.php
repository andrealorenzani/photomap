<?php

declare(strict_types=1);

namespace Photomap\Backend\Middleware;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;
use Photomap\Backend\Repositories\UserRepository;

/**
 * Gates authenticated user-facing routes on the session user's live account status. Two
 * instances are wired in Bootstrap.php:
 *
 * - a broad instance, blockedStatuses=['disabled'], attached to every existing authenticated
 *   route — a disabled account is fully suspended, not just upload-blocked.
 * - a narrow instance, blockedStatuses=['disabled','pending'], attached only to
 *   POST /api/photos — pending accounts may otherwise use the app fully; only uploads are
 *   blocked, per the literal request wording ("the account exists but uploads are blocked").
 *
 * Runs after AuthMiddleware (so a missing/invalid session is still a 401 from AuthMiddleware,
 * not this class) and before CsrfMiddleware, so a disabled/pending account gets its specific
 * account_disabled/account_pending error code even on a request that also lacks a CSRF token.
 */
final class AccountStatusMiddleware
{
    private const MESSAGES = [
        'pending' => 'Your account is pending admin approval; uploads are disabled until then.',
        'disabled' => 'This account has been disabled.',
    ];

    /**
     * @param string[] $blockedStatuses
     */
    public function __construct(
        private readonly UserRepository $users,
        private readonly array $blockedStatuses
    ) {
    }

    public function __invoke(Request $request): ?Response
    {
        $userId = $_SESSION['user_id'] ?? null;
        if ($userId === null) {
            // No session user at all — let AuthMiddleware (which must run before this one)
            // handle the unauthenticated case; nothing to gate here.
            return null;
        }

        $user = $this->users->findById((int) $userId);
        if ($user === null) {
            return null;
        }

        $status = (string) $user['status'];
        if (!in_array($status, $this->blockedStatuses, true)) {
            return null;
        }

        $message = self::MESSAGES[$status] ?? 'This account cannot perform that action.';

        return JsonResponse::error('account_' . $status, $message, 403);
    }
}
