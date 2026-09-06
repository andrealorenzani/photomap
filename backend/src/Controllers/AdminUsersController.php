<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Services\MailerInterface;

final class AdminUsersController
{
    public function __construct(
        private readonly UserRepository $users,
        private readonly PhotoRepository $photos,
        private readonly ShareLinkRepository $shareLinks,
        private readonly MailerInterface $mailer
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $query = trim((string) $request->query('q', ''));
        $status = $request->query('status');
        $status = $status === '' ? null : $status;
        $sort = (string) $request->query('sort', 'created_at');
        $dir = (string) $request->query('dir', 'desc');
        $page = max(1, (int) $request->query('page', '1'));
        $perPage = max(1, min(200, (int) $request->query('perPage', '25')));

        $rows = $this->users->search($query, $status, $sort, $dir, $page, $perPage);
        $total = $this->users->count($query, $status);
        $usedBytesByUser = $this->photos->sumBytesGroupedByUser();

        $users = array_map(function (array $row) use ($usedBytesByUser) {
            $userId = (int) $row['id'];
            // Existence/timestamp indicator only — the raw share token/URL is never fetched
            // here, let alone returned. See ShareLinkRepository::findActiveCreatedAtForUser().
            $activeShareLink = $this->shareLinks->findActiveCreatedAtForUser($userId);

            return [
                'id' => $userId,
                'email' => $row['email'],
                'status' => $row['status'],
                'storageQuotaBytes' => $row['storage_quota_bytes'] !== null ? (int) $row['storage_quota_bytes'] : null,
                'createdAt' => $row['created_at'],
                'approvedAt' => $row['approved_at'],
                'usedBytes' => $usedBytesByUser[$userId] ?? 0,
                'hasShareLink' => $activeShareLink !== null,
                'shareLinkCreatedAt' => $activeShareLink['createdAt'] ?? null,
            ];
        }, $rows);

        return new JsonResponse(['users' => $users, 'total' => $total, 'page' => $page, 'perPage' => $perPage]);
    }

    public function activate(Request $request): JsonResponse
    {
        $id = (int) $request->routeParam('id');
        $user = $this->users->findById($id);
        if ($user === null) {
            return JsonResponse::error('not_found', 'User not found.', 404);
        }

        $body = $request->json();
        $quotaRaw = $body['storageQuotaBytes'] ?? null;
        $quotaBytes = null;
        if ($quotaRaw !== null) {
            if (!is_numeric($quotaRaw) || (int) $quotaRaw < 0) {
                return JsonResponse::error('invalid_quota', 'storageQuotaBytes must be a non-negative number.', 422);
            }
            $quotaBytes = (int) $quotaRaw;
        }

        $this->users->activate($id, $quotaBytes);

        $this->sendBestEffort(
            $user['email'],
            'Your Photomap account is now active',
            "Good news — your Photomap account has been approved by an administrator.\n\n" .
            "You can now upload and store photos. Log in to get started."
        );

        $updated = $this->users->findById($id);

        return new JsonResponse($this->toAdminJson($updated));
    }

    public function disable(Request $request): JsonResponse
    {
        $id = (int) $request->routeParam('id');
        $user = $this->users->findById($id);
        if ($user === null) {
            return JsonResponse::error('not_found', 'User not found.', 404);
        }

        $this->users->disable($id);

        $this->sendBestEffort(
            $user['email'],
            'Your Photomap account has been deactivated',
            "Your Photomap account has been deactivated by an administrator.\n\n" .
            "You will no longer be able to log in or access your photos through this account."
        );

        $updated = $this->users->findById($id);

        return new JsonResponse($this->toAdminJson($updated));
    }

    /**
     * Never includes the password hash or any share-link token — only the same
     * non-actionable fields exposed by index().
     */
    private function toAdminJson(array $user): array
    {
        $userId = (int) $user['id'];
        $activeShareLink = $this->shareLinks->findActiveCreatedAtForUser($userId);

        return [
            'id' => $userId,
            'email' => $user['email'],
            'status' => $user['status'],
            'storageQuotaBytes' => $user['storage_quota_bytes'] !== null ? (int) $user['storage_quota_bytes'] : null,
            'createdAt' => $user['created_at'],
            'approvedAt' => $user['approved_at'],
            'usedBytes' => $this->photos->sumBytesForUser($userId),
            'hasShareLink' => $activeShareLink !== null,
            'shareLinkCreatedAt' => $activeShareLink['createdAt'] ?? null,
        ];
    }

    private function sendBestEffort(string $toAddress, string $subject, string $body): void
    {
        try {
            $this->mailer->send($toAddress, $subject, $body);
        } catch (\Throwable $e) {
            error_log('AdminUsersController: notification email failed: ' . $e->getMessage());
        }
    }
}
