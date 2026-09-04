<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Services\PhotoPresenter;

final class ShareController
{
    public function __construct(
        private readonly ShareLinkRepository $shareLinks,
        private readonly PhotoRepository $photos,
        private readonly PhotoPresenter $presenter
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        $token = (string) $request->routeParam('token');

        $shareLink = $this->shareLinks->findActiveByToken($token);
        if ($shareLink === null) {
            return JsonResponse::error('not_found', 'This share link is invalid or has been revoked.', 404);
        }

        $rows = $this->photos->findAllForUser((int) $shareLink['user_id']);
        $photos = array_map(fn (array $row) => $this->presenter->toShareJson($row, $token), $rows);

        return new JsonResponse(['photos' => $photos]);
    }
}
