<?php

declare(strict_types=1);

namespace Photomap\Backend\Middleware;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;

final class CsrfMiddleware
{
    public function __invoke(Request $request): ?Response
    {
        $expected = $_SESSION['csrf_token'] ?? null;
        $provided = $request->header('X-CSRF-Token');

        if (!is_string($expected) || !is_string($provided) || $provided === '' || !hash_equals($expected, $provided)) {
            return JsonResponse::error('csrf_invalid', 'Missing or invalid CSRF token.', 403);
        }

        return null;
    }
}
