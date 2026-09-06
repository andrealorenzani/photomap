<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\UserRepository;

final class AdminStatsController
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly PhotoRepository $photos
    ) {
    }

    public function show(Request $request): JsonResponse
    {
        $byStatus = $this->users->countByStatus();

        return new JsonResponse([
            'usersByStatus' => $byStatus,
            'totalUsers' => $byStatus['pending'] + $byStatus['active'] + $byStatus['disabled'],
            'totalPhotos' => $this->photos->countAll(),
            'totalBytesStored' => $this->photos->sumAllBytes(),
        ]);
    }
}
