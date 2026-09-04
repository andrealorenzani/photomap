<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use PDO;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\ShareLinkRepository;

final class ShareLinksController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly ShareLinkRepository $shareLinks
    ) {
    }

    public function store(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];

        $token = rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');

        $this->pdo->beginTransaction();
        try {
            $this->shareLinks->revokeActiveForUser($userId);
            $id = $this->shareLinks->create($userId, $token);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        return new JsonResponse(['id' => $id, 'token' => $token, 'url' => "/share/{$token}"], 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];
        $id = (int) $request->routeParam('id');

        $revoked = $this->shareLinks->revokeForUser($id, $userId);
        if (!$revoked) {
            return JsonResponse::error('not_found', 'Share link not found.', 404);
        }

        return new JsonResponse(['ok' => true]);
    }
}
