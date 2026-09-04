<?php

declare(strict_types=1);

namespace Photomap\Backend\Middleware;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;

final class AuthMiddleware
{
    public function __invoke(Request $request): ?Response
    {
        if (empty($_SESSION['user_id'])) {
            return JsonResponse::error('unauthorized', 'Authentication required.', 401);
        }

        return null;
    }
}
