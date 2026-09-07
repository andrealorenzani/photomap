<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\RegistrationAttemptRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Services\DisposableEmailDomainList;
use Photomap\Backend\Services\MailerInterface;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Session;

final class AuthController
{
    // A fixed, valid bcrypt hash used for the dummy password_verify() call when the
    // submitted email doesn't exist, so response timing doesn't leak which case occurred.
    private const DUMMY_HASH = '$2y$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi';

    public function __construct(
        private readonly UserRepository $users,
        private readonly RateLimiter $rateLimiter,
        private readonly MailerInterface $mailer,
        private readonly RegistrationAttemptRepository $registrationAttempts,
        private readonly DisposableEmailDomainList $disposableEmailDomains,
        private readonly ?string $adminNotifyEmail = null,
        private readonly int $registrationRateLimitMaxAttempts = 5,
        private readonly int $registrationRateLimitWindowSeconds = 3600,
        private readonly int $registrationMinFormSeconds = 2
    ) {
    }

    public function csrfToken(Request $request): JsonResponse
    {
        return new JsonResponse(['csrfToken' => $_SESSION['csrf_token']]);
    }

    public function register(Request $request): JsonResponse
    {
        $body = $request->json();
        $email = is_string($body['email'] ?? null) ? trim($body['email']) : '';
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        // Honeypot: a hidden, off-screen (not display:none) form field. Real users/screen
        // readers/keyboard navigation never fill it in; bots that blindly fill every field do.
        $honeypot = is_string($body['website'] ?? null) ? trim($body['website']) : '';
        // Epoch ms captured client-side when the registration form first mounts/switches into
        // register mode -- used for the timing check below.
        $formRenderedAt = is_numeric($body['formRenderedAt'] ?? null) ? (int) $body['formRenderedAt'] : null;
        $ip = $request->ip();

        // Every registration POST is recorded regardless of outcome, mirroring login_attempts'
        // "record everything" pattern -- this happens before the rate-limit check below so a
        // bot retrying past the honeypot/timing checks still counts toward the throttle. The
        // count used for *this* request's own threshold decision is read first, so it reflects
        // only attempts strictly before this one (no off-by-one from counting itself).
        $recentAttemptsFromThisIp = $this->registrationAttempts->countRecentByIp(
            $ip,
            $this->registrationRateLimitWindowSeconds
        );
        $this->registrationAttempts->record($ip);

        if ($honeypot !== '') {
            error_log("AuthController::register: honeypot field filled in from IP {$ip}; rejecting as bot.");

            return JsonResponse::error('bot_detected', 'Registration could not be completed.', 422);
        }

        if ($this->registrationMinFormSeconds > 0) {
            $elapsedMs = $formRenderedAt !== null ? (self::nowMillis() - $formRenderedAt) : null;
            if ($elapsedMs === null || $elapsedMs < $this->registrationMinFormSeconds * 1000) {
                return JsonResponse::error('bot_detected', 'Registration could not be completed.', 422);
            }
        }

        if ($recentAttemptsFromThisIp >= $this->registrationRateLimitMaxAttempts) {
            return JsonResponse::error(
                'too_many_attempts',
                'Too many registration attempts from this network. Please try again later.',
                429
            );
        }

        if ($email !== '' && $this->disposableEmailDomains->isDisposable($email)) {
            return JsonResponse::error(
                'disposable_email',
                'Please use a permanent (non-disposable) email address to register.',
                422
            );
        }

        if ($email === '' || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return JsonResponse::error('invalid_email', 'A valid email address is required.', 422);
        }

        if (strlen($password) < 8) {
            return JsonResponse::error('invalid_password', 'Password must be at least 8 characters.', 422);
        }

        if ($this->users->findByEmail($email) !== null) {
            return JsonResponse::error('email_taken', 'An account with this email already exists.', 409);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $id = $this->users->create($email, $hash);

        // Best-effort, never blocks registration itself: if ADMIN_NOTIFY_EMAIL isn't
        // configured (a legitimate, tolerated boot-time state for an incompletely-upgraded
        // deploy) or the mail transport fails, this degrades to a logged no-op.
        if ($this->adminNotifyEmail !== null && $this->adminNotifyEmail !== '') {
            try {
                $this->mailer->send(
                    $this->adminNotifyEmail,
                    'Photomap: new account registration',
                    "A new account has registered and is pending approval:\n\n" .
                    "Email: {$email}\n" .
                    "User ID: {$id}\n\n" .
                    'Activate or disable this account from the /admin console.'
                );
            } catch (\Throwable $e) {
                error_log('AuthController::register: notification email failed: ' . $e->getMessage());
            }
        } else {
            error_log('AuthController::register: ADMIN_NOTIFY_EMAIL is not configured; skipping new-registration notification.');
        }

        return new JsonResponse(['id' => $id, 'email' => $email, 'status' => 'pending'], 201);
    }

    public function login(Request $request): JsonResponse
    {
        $body = $request->json();
        $email = is_string($body['email'] ?? null) ? trim($body['email']) : '';
        $password = is_string($body['password'] ?? null) ? $body['password'] : '';
        $ip = $request->ip();

        if ($email === '' || $password === '') {
            return JsonResponse::error('invalid_credentials', 'Email and password are required.', 401);
        }

        if ($this->rateLimiter->isBlocked($email, $ip)) {
            return JsonResponse::error('too_many_attempts', 'Too many failed login attempts. Please try again later.', 429);
        }

        $user = $this->users->findByEmail($email);

        if ($user === null) {
            // Dummy verify so unknown-email and wrong-password take a similar amount of time.
            password_verify($password, self::DUMMY_HASH);
            $this->rateLimiter->recordAttempt($email, $ip, false);

            return JsonResponse::error('invalid_credentials', 'Invalid email or password.', 401);
        }

        if (!password_verify($password, $user['password_hash'])) {
            $this->rateLimiter->recordAttempt($email, $ip, false);

            return JsonResponse::error('invalid_credentials', 'Invalid email or password.', 401);
        }

        if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
            $this->users->updatePasswordHash((int) $user['id'], password_hash($password, PASSWORD_DEFAULT));
        }

        session_regenerate_id(true);
        // A session is always exactly one identity — user or admin, never both. A browser
        // that happens to hold an admin session in the same cookie must not keep it after a
        // normal user logs in here.
        unset($_SESSION['admin']);
        $_SESSION['user_id'] = (int) $user['id'];
        $_SESSION['email'] = $user['email'];
        Session::regenerateCsrfToken();

        $this->rateLimiter->recordAttempt($email, $ip, true);

        return new JsonResponse(['id' => (int) $user['id'], 'email' => $user['email'], 'status' => $user['status']]);
    }

    public function logout(Request $request): JsonResponse
    {
        Session::destroy();

        return new JsonResponse(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];
        $user = $this->users->findById($userId);

        if ($user === null) {
            return JsonResponse::error('unauthorized', 'Authentication required.', 401);
        }

        return new JsonResponse(['id' => (int) $user['id'], 'email' => $user['email'], 'status' => $user['status']]);
    }

    private static function nowMillis(): int
    {
        return (int) round(microtime(true) * 1000);
    }
}
