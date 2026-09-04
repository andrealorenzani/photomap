<?php

declare(strict_types=1);

namespace Photomap\Backend;

use Photomap\Backend\Controllers\AccountController;
use Photomap\Backend\Controllers\AuthController;
use Photomap\Backend\Controllers\GeocodeController;
use Photomap\Backend\Controllers\MediaController;
use Photomap\Backend\Controllers\PhotosController;
use Photomap\Backend\Controllers\ShareController;
use Photomap\Backend\Controllers\ShareLinksController;
use Photomap\Backend\Middleware\AuthMiddleware;
use Photomap\Backend\Middleware\CsrfMiddleware;
use Photomap\Backend\Repositories\GeocodeCacheRepository;
use Photomap\Backend\Repositories\LoginAttemptRepository;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Routing\Router;
use Photomap\Backend\Services\FileValidator;
use Photomap\Backend\Services\GeocodeClientInterface;
use Photomap\Backend\Services\ImageProcessor;
use Photomap\Backend\Services\NominatimClient;
use Photomap\Backend\Services\NominatimRateLimiter;
use Photomap\Backend\Services\PhotoPresenter;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Services\SignedUrl;
use Photomap\Backend\Services\StorageQuotaService;

final class Bootstrap
{
    /**
     * Builds a fully-wired Router. $geocodeClient can be overridden by tests to inject a
     * FakeGeocodeClient instead of the real Nominatim HTTP client.
     */
    public static function createRouter(?GeocodeClientInterface $geocodeClient = null): Router
    {
        $pdo = Database::connect();

        $storagePath = rtrim(Config::require('STORAGE_PATH'), '/');
        $maxUploadBytes = Config::getInt('MAX_UPLOAD_BYTES', 26214400);
        $quotaBytes = Config::getInt('STORAGE_QUOTA_BYTES', 104857600);
        $appSecret = Config::require('APP_SECRET');
        $nominatimUserAgent = Config::get('NOMINATIM_USER_AGENT', 'Photomap/1.0');
        $nominatimMinInterval = (float) Config::get('NOMINATIM_MIN_INTERVAL_SECONDS', '1');
        $rateLimitMax = Config::getInt('RATE_LIMIT_LOGIN_MAX_ATTEMPTS', 5);
        $rateLimitWindow = Config::getInt('RATE_LIMIT_LOGIN_WINDOW_SECONDS', 900);

        $users = new UserRepository($pdo);
        $photos = new PhotoRepository($pdo);
        $shareLinks = new ShareLinkRepository($pdo);
        $geocodeCache = new GeocodeCacheRepository($pdo);
        $loginAttempts = new LoginAttemptRepository($pdo);

        $fileValidator = new FileValidator();
        $imageProcessor = new ImageProcessor($storagePath);
        $quota = new StorageQuotaService($pdo, $users, $photos, $quotaBytes);
        $rateLimiter = new RateLimiter($loginAttempts, $rateLimitMax, $rateLimitWindow);
        $signedUrl = new SignedUrl($appSecret);
        $presenter = new PhotoPresenter($signedUrl);
        $nominatimRateLimiter = new NominatimRateLimiter($pdo, $nominatimMinInterval);
        $client = $geocodeClient ?? new NominatimClient($nominatimUserAgent ?? 'Photomap/1.0');

        $authController = new AuthController($users, $rateLimiter);
        $accountController = new AccountController($pdo, $users, $photos, $storagePath);
        $photosController = new PhotosController(
            $photos,
            $imageProcessor,
            $fileValidator,
            $quota,
            $presenter,
            $storagePath,
            $maxUploadBytes
        );
        $mediaController = new MediaController($photos, $shareLinks, $signedUrl, $storagePath);
        $shareLinksController = new ShareLinksController($pdo, $shareLinks);
        $shareController = new ShareController($shareLinks, $photos, $presenter);
        $geocodeController = new GeocodeController($geocodeCache, $client, $nominatimRateLimiter);

        $auth = new AuthMiddleware();
        $csrf = new CsrfMiddleware();

        $router = new Router();

        // Public, no auth/CSRF.
        $router->get('/api/csrf-token', [$authController, 'csrfToken']);
        $router->post('/api/register', [$authController, 'register'], [$csrf]);
        $router->post('/api/login', [$authController, 'login'], [$csrf]);
        $router->get('/api/share/{token}', [$shareController, 'show']);
        $router->get('/api/photos/{id}/file', [$mediaController, 'file']);
        $router->get('/api/photos/{id}/thumbnail', [$mediaController, 'thumbnail']);

        // Auth required, no CSRF (GET only).
        $router->get('/api/me', [$authController, 'me'], [$auth]);
        $router->get('/api/photos', [$photosController, 'index'], [$auth]);
        $router->get('/api/geocode', [$geocodeController, 'show'], [$auth]);

        // Auth + CSRF required (state-changing).
        $router->post('/api/logout', [$authController, 'logout'], [$auth, $csrf]);
        $router->delete('/api/account', [$accountController, 'destroy'], [$auth, $csrf]);
        $router->post('/api/photos', [$photosController, 'store'], [$auth, $csrf]);
        $router->delete('/api/photos/{id}', [$photosController, 'destroy'], [$auth, $csrf]);
        $router->post('/api/share-links', [$shareLinksController, 'store'], [$auth, $csrf]);
        $router->delete('/api/share-links/{id}', [$shareLinksController, 'destroy'], [$auth, $csrf]);

        return $router;
    }
}
