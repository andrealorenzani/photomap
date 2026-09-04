<?php

declare(strict_types=1);

namespace Photomap\Backend\Middleware;

use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;

/**
 * Applies CORS headers for a genuinely split-origin deployment (frontend on a different origin
 * than the backend). Both the local dev path (Vite proxy) and the Docker path (nginx proxy) are
 * same-origin by design and never trigger this — CORS_ALLOWED_ORIGINS defaults to empty, which
 * means no CORS headers are ever emitted.
 *
 * Not run through the Router's per-route middleware list, since it must also handle the OPTIONS
 * preflight for routes that never registered an OPTIONS handler. Invoked directly from
 * public/index.php, before the Router dispatches and before the session starts (a preflight
 * request never needs a session).
 */
final class CorsMiddleware
{
    /** @param string[] $allowedOrigins Exact-match allow-list (never substring/suffix matched). */
    public function __construct(private readonly array $allowedOrigins)
    {
    }

    /**
     * Returns a Response to short-circuit the request (always for OPTIONS preflight, never
     * otherwise) or null to let the request continue to the normal router dispatch. CORS
     * response headers for non-OPTIONS requests are applied as a side effect via header()
     * regardless of the return value, so they reach whatever Response the router eventually
     * sends.
     */
    public function handle(Request $request): ?Response
    {
        $origin = $request->header('Origin');
        $isAllowed = $origin !== null && $origin !== '' && in_array($origin, $this->allowedOrigins, true);

        if (!empty($this->allowedOrigins)) {
            // Signals to caches that the response depends on the Origin header, whether or not
            // this particular origin was allow-listed.
            header('Vary: Origin');
        }

        if ($isAllowed) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Credentials: true');
        }
        // When Origin is present but not allow-listed, deliberately no
        // Access-Control-Allow-Origin header is emitted at all (not an empty/wrong value) —
        // this is what makes the browser reject the response.

        if ($request->method() === 'OPTIONS') {
            if ($isAllowed) {
                header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
                header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token');
            }

            return new Response('', 204);
        }

        return null;
    }
}
