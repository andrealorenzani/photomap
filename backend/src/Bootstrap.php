<?php

declare(strict_types=1);

namespace Photomap\Backend;

use Photomap\Backend\Controllers\AccountController;
use Photomap\Backend\Controllers\AdminAuthController;
use Photomap\Backend\Controllers\AdminSettingsController;
use Photomap\Backend\Controllers\AdminStatsController;
use Photomap\Backend\Controllers\AdminUsersController;
use Photomap\Backend\Controllers\AuthController;
use Photomap\Backend\Controllers\GeocodeController;
use Photomap\Backend\Controllers\MediaController;
use Photomap\Backend\Controllers\PhotosController;
use Photomap\Backend\Controllers\ShareController;
use Photomap\Backend\Controllers\ShareLinksController;
use Photomap\Backend\Middleware\AccountStatusMiddleware;
use Photomap\Backend\Middleware\AdminAuthMiddleware;
use Photomap\Backend\Middleware\AuthMiddleware;
use Photomap\Backend\Middleware\CsrfMiddleware;
use Photomap\Backend\Repositories\AppSettingsRepository;
use Photomap\Backend\Repositories\GeocodeCacheRepository;
use Photomap\Backend\Repositories\LoginAttemptRepository;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\RegistrationAttemptRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Routing\Router;
use Photomap\Backend\Services\AppSettingsService;
use Photomap\Backend\Services\DisposableEmailDomainList;
use Photomap\Backend\Services\FileValidator;
use Photomap\Backend\Services\GeocodeClientInterface;
use Photomap\Backend\Services\ImageProcessor;
use Photomap\Backend\Services\MailerInterface;
use Photomap\Backend\Services\NominatimClient;
use Photomap\Backend\Services\NominatimRateLimiter;
use Photomap\Backend\Services\PhotoPresenter;
use Photomap\Backend\Services\PhpMailMailer;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Services\SignedUrl;
use Photomap\Backend\Services\StorageQuotaService;

final class Bootstrap
{
    /**
     * Builds a fully-wired Router. $geocodeClient/$mailer can be overridden by tests to
     * inject a FakeGeocodeClient/FakeMailer instead of the real Nominatim HTTP client /
     * PHP mail() transport.
     */
    public static function createRouter(?GeocodeClientInterface $geocodeClient = null, ?MailerInterface $mailer = null): Router
    {
        $pdo = Database::connect();

        $storagePath = rtrim(Config::require('STORAGE_PATH'), '/');
        $maxUploadBytes = Config::getInt('MAX_UPLOAD_BYTES', 26214400);
        $appSecret = Config::require('APP_SECRET');
        $nominatimUserAgent = Config::get('NOMINATIM_USER_AGENT', 'Photomap/1.0');
        $nominatimMinInterval = (float) Config::get('NOMINATIM_MIN_INTERVAL_SECONDS', '1');
        $rateLimitMax = Config::getInt('RATE_LIMIT_LOGIN_MAX_ATTEMPTS', 5);
        $rateLimitWindow = Config::getInt('RATE_LIMIT_LOGIN_WINDOW_SECONDS', 900);
        $registrationRateLimitMax = Config::getInt('RATE_LIMIT_REGISTRATION_MAX_ATTEMPTS', 5);
        $registrationRateLimitWindow = Config::getInt('RATE_LIMIT_REGISTRATION_WINDOW_SECONDS', 3600);
        $registrationMinFormSeconds = Config::getInt('REGISTRATION_MIN_FORM_SECONDS', 2);
        $mailFromAddress = Config::get('MAIL_FROM_ADDRESS', 'no-reply@example.com');
        $mailFromName = Config::get('MAIL_FROM_NAME', 'Photomap');
        $adminNotifyEmail = Config::get('ADMIN_NOTIFY_EMAIL');

        $users = new UserRepository($pdo);
        $photos = new PhotoRepository($pdo);
        $shareLinks = new ShareLinkRepository($pdo);
        $geocodeCache = new GeocodeCacheRepository($pdo);
        $loginAttempts = new LoginAttemptRepository($pdo);
        $registrationAttempts = new RegistrationAttemptRepository($pdo);
        $disposableEmailDomains = new DisposableEmailDomainList();
        $appSettingsRepository = new AppSettingsRepository($pdo);

        $fileValidator = new FileValidator();
        $imageProcessor = new ImageProcessor($storagePath);
        $appSettings = new AppSettingsService($appSettingsRepository);
        $quota = new StorageQuotaService($pdo, $users, $photos, $appSettings);
        $rateLimiter = new RateLimiter($loginAttempts, $rateLimitMax, $rateLimitWindow);
        $signedUrl = new SignedUrl($appSecret);
        $presenter = new PhotoPresenter($signedUrl);
        $nominatimRateLimiter = new NominatimRateLimiter($pdo, $nominatimMinInterval);
        $client = $geocodeClient ?? new NominatimClient($nominatimUserAgent ?? 'Photomap/1.0');
        $mailerInstance = $mailer ?? self::resolveDefaultMailer($mailFromAddress, $mailFromName);

        $authController = new AuthController(
            $users,
            $rateLimiter,
            $mailerInstance,
            $registrationAttempts,
            $disposableEmailDomains,
            $adminNotifyEmail,
            $registrationRateLimitMax,
            $registrationRateLimitWindow,
            $registrationMinFormSeconds
        );
        $accountController = new AccountController($pdo, $users, $photos, $storagePath);
        $photosController = new PhotosController(
            $photos,
            $imageProcessor,
            $fileValidator,
            $quota,
            $presenter,
            $storagePath,
            $maxUploadBytes,
            $appSettings
        );
        $mediaController = new MediaController($photos, $shareLinks, $signedUrl, $storagePath);
        $shareLinksController = new ShareLinksController($pdo, $shareLinks);
        $shareController = new ShareController($shareLinks, $photos, $presenter);
        $geocodeController = new GeocodeController($geocodeCache, $client, $nominatimRateLimiter);

        $adminAuthController = new AdminAuthController($rateLimiter);
        $adminUsersController = new AdminUsersController($users, $photos, $shareLinks, $mailerInstance);
        $adminSettingsController = new AdminSettingsController($appSettings);
        $adminStatsController = new AdminStatsController($users, $photos);

        $auth = new AuthMiddleware();
        $csrf = new CsrfMiddleware();
        $adminAuth = new AdminAuthMiddleware();
        // Broad: a disabled account is fully suspended from every existing authenticated
        // route. Narrow: pending accounts may use everything except uploading.
        $accountStatusBroad = new AccountStatusMiddleware($users, ['disabled']);
        $accountStatusUpload = new AccountStatusMiddleware($users, ['disabled', 'pending']);

        $router = new Router();

        // Public, no auth/CSRF.
        $router->get('/api/csrf-token', [$authController, 'csrfToken']);
        $router->post('/api/register', [$authController, 'register'], [$csrf]);
        $router->post('/api/login', [$authController, 'login'], [$csrf]);
        $router->get('/api/share/{token}', [$shareController, 'show']);
        $router->get('/api/photos/{id}/file', [$mediaController, 'file']);
        $router->get('/api/photos/{id}/thumbnail', [$mediaController, 'thumbnail']);

        // Auth required, no CSRF (GET only).
        $router->get('/api/me', [$authController, 'me'], [$auth, $accountStatusBroad]);
        $router->get('/api/photos', [$photosController, 'index'], [$auth, $accountStatusBroad]);
        $router->get('/api/geocode', [$geocodeController, 'show'], [$auth, $accountStatusBroad]);

        // Auth + CSRF required (state-changing). Account-status gate runs before CSRF so a
        // disabled/pending account gets its specific error code even without a CSRF token.
        $router->post('/api/logout', [$authController, 'logout'], [$auth, $accountStatusBroad, $csrf]);
        $router->delete('/api/account', [$accountController, 'destroy'], [$auth, $accountStatusBroad, $csrf]);
        $router->post('/api/photos', [$photosController, 'store'], [$auth, $accountStatusUpload, $csrf]);
        $router->delete('/api/photos/{id}', [$photosController, 'destroy'], [$auth, $accountStatusBroad, $csrf]);
        $router->patch('/api/photos/{id}', [$photosController, 'update'], [$auth, $accountStatusBroad, $csrf]);
        $router->post('/api/share-links', [$shareLinksController, 'store'], [$auth, $accountStatusBroad, $csrf]);
        $router->delete('/api/share-links/{id}', [$shareLinksController, 'destroy'], [$auth, $accountStatusBroad, $csrf]);

        // Admin console. Login/logout get exactly the same CSRF treatment as every other
        // state-changing endpoint (no bootstrap exemption), but sit outside AdminAuthMiddleware
        // the same way /api/register and /api/login sit outside AuthMiddleware. Every other
        // admin route requires an established admin session.
        $router->post('/api/admin/login', [$adminAuthController, 'login'], [$csrf]);
        $router->post('/api/admin/logout', [$adminAuthController, 'logout'], [$adminAuth, $csrf]);
        $router->get('/api/admin/me', [$adminAuthController, 'me'], [$adminAuth]);
        $router->get('/api/admin/users', [$adminUsersController, 'index'], [$adminAuth]);
        $router->post('/api/admin/users/{id}/activate', [$adminUsersController, 'activate'], [$adminAuth, $csrf]);
        $router->post('/api/admin/users/{id}/disable', [$adminUsersController, 'disable'], [$adminAuth, $csrf]);
        $router->get('/api/admin/settings', [$adminSettingsController, 'show'], [$adminAuth]);
        $router->patch('/api/admin/settings', [$adminSettingsController, 'update'], [$adminAuth, $csrf]);
        $router->get('/api/admin/stats', [$adminStatsController, 'show'], [$adminAuth]);

        return $router;
    }

    /**
     * Chooses the default mailer when the caller (production entrypoint, or a test that didn't
     * pass its own $mailer) doesn't inject one. MAIL_TRANSPORT=fake opts into the in-memory
     * FakeMailer used by the test suite, so the real `php -S` subprocess spawned by Feature
     * tests never calls PHP's mail() for real (best-effort real mail sending is otherwise
     * unaffected — this only ever triggers when MAIL_TRANSPORT is explicitly set to "fake",
     * which only `.env.test` does). Guarded with class_exists() so a production install built
     * with `composer install --no-dev` (no autoload-dev, so the test namespace doesn't exist)
     * can never fatal even if MAIL_TRANSPORT were mistakenly set to "fake" there.
     */
    private static function resolveDefaultMailer(?string $mailFromAddress, ?string $mailFromName): MailerInterface
    {
        $mailTransport = Config::get('MAIL_TRANSPORT');
        $fakeMailerClass = 'Photomap\\Backend\\Tests\\Support\\FakeMailer';

        if ($mailTransport === 'fake' && class_exists($fakeMailerClass)) {
            return new $fakeMailerClass();
        }

        return new PhpMailMailer($mailFromAddress ?? 'no-reply@example.com', $mailFromName ?? 'Photomap');
    }
}
