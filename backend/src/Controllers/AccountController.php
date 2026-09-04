<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use PDO;
use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Session;

final class AccountController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly UserRepository $users,
        private readonly PhotoRepository $photos,
        private readonly string $storagePath
    ) {
    }

    public function destroy(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];

        $this->pdo->beginTransaction();
        try {
            $filePaths = $this->photos->findFilePathsForUser($userId);
            $this->users->delete($userId);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $e;
        }

        foreach ($filePaths as $paths) {
            @unlink($this->storagePath . '/' . $paths['storage_path']);
            @unlink($this->storagePath . '/' . $paths['thumbnail_path']);
        }

        Session::destroy();

        return new JsonResponse(['ok' => true]);
    }
}
