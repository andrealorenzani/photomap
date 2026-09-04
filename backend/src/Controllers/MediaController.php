<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Services\SignedUrl;

final class MediaController
{
    public function __construct(
        private readonly PhotoRepository $photos,
        private readonly ShareLinkRepository $shareLinks,
        private readonly SignedUrl $signedUrl,
        private readonly string $storagePath
    ) {
    }

    public function file(Request $request): Response
    {
        return $this->serve($request, SignedUrl::VARIANT_FILE);
    }

    public function thumbnail(Request $request): Response
    {
        return $this->serve($request, SignedUrl::VARIANT_THUMBNAIL);
    }

    private function serve(Request $request, string $variant): Response
    {
        $id = (int) $request->routeParam('id');
        $ctx = $request->query('ctx', '');
        $expires = (int) $request->query('expires', '0');
        $sig = (string) $request->query('sig', '');

        $photo = $this->photos->find($id);
        if ($photo === null) {
            return JsonResponse::error('forbidden', 'Invalid or expired media URL.', 403);
        }

        if ($ctx === 'owner') {
            if (!$this->signedUrl->verifyOwner($id, $variant, $expires, $sig)) {
                return JsonResponse::error('forbidden', 'Invalid or expired media URL.', 403);
            }
        } elseif ($ctx === 'share') {
            $shareToken = (string) $request->query('share_token', '');
            if ($shareToken === '' || !$this->signedUrl->verifyShare($shareToken, $id, $variant, $expires, $sig)) {
                return JsonResponse::error('forbidden', 'Invalid or expired media URL.', 403);
            }

            // Revocation must take effect immediately for share-context URLs: re-check the
            // share link is still active and actually owns this photo, on every fetch.
            $shareLink = $this->shareLinks->findActiveByToken($shareToken);
            if ($shareLink === null || (int) $shareLink['user_id'] !== (int) $photo['user_id']) {
                return JsonResponse::error('forbidden', 'Invalid or expired media URL.', 403);
            }
        } else {
            return JsonResponse::error('forbidden', 'Invalid or expired media URL.', 403);
        }

        $relativePath = $variant === SignedUrl::VARIANT_THUMBNAIL ? $photo['thumbnail_path'] : $photo['storage_path'];
        $absolutePath = $this->storagePath . '/' . $relativePath;

        if (!is_file($absolutePath)) {
            return JsonResponse::error('not_found', 'Media file not found.', 404);
        }

        $contents = file_get_contents($absolutePath);
        if ($contents === false) {
            return JsonResponse::error('not_found', 'Media file not found.', 404);
        }

        return (new Response($contents, 200))
            ->withHeader('Content-Type', 'image/jpeg')
            ->withHeader('Cache-Control', 'private, max-age=60');
    }
}
