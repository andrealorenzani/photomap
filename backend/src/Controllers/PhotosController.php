<?php

declare(strict_types=1);

namespace Photomap\Backend\Controllers;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Services\FileValidator;
use Photomap\Backend\Services\ImageProcessor;
use Photomap\Backend\Services\PhotoPresenter;
use Photomap\Backend\Services\StorageQuotaService;

final class PhotosController
{
    public function __construct(
        private readonly PhotoRepository $photos,
        private readonly ImageProcessor $imageProcessor,
        private readonly FileValidator $fileValidator,
        private readonly StorageQuotaService $quota,
        private readonly PhotoPresenter $presenter,
        private readonly string $storagePath,
        private readonly int $maxUploadBytes
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];
        $rows = $this->photos->findAllForUser($userId);

        $photos = array_map(fn (array $row) => $this->presenter->toOwnerJson($row), $rows);

        return new JsonResponse(['photos' => $photos]);
    }

    public function store(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];

        $file = $request->file('photo');
        if ($file === null || !isset($file['tmp_name']) || $file['tmp_name'] === '' || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            if (($file['error'] ?? null) === UPLOAD_ERR_INI_SIZE || ($file['error'] ?? null) === UPLOAD_ERR_FORM_SIZE) {
                return JsonResponse::error('file_too_large', 'Uploaded file exceeds the maximum allowed size.', 413);
            }

            return JsonResponse::error('missing_file', 'A "photo" file field is required.', 422);
        }

        $size = (int) ($file['size'] ?? 0);
        if ($size > $this->maxUploadBytes) {
            return JsonResponse::error('file_too_large', 'Uploaded file exceeds the maximum allowed size.', 413);
        }

        $tmpPath = $file['tmp_name'];
        if (!is_uploaded_file($tmpPath)) {
            return JsonResponse::error('invalid_upload', 'Invalid upload.', 422);
        }

        $mime = $this->fileValidator->detectMimeType($tmpPath);
        if (!$this->fileValidator->isAllowedMimeType($mime)) {
            return JsonResponse::error('invalid_file_type', 'Only JPEG, PNG, and WebP images are supported.', 422);
        }

        if ($mime === 'image/webp' && !ImageProcessor::isWebpSupported()) {
            return JsonResponse::error(
                'webp_unsupported',
                'This server\'s image library does not support WebP uploads.',
                422
            );
        }

        [$lat, $lon, $latLonError] = $this->parseLatLon($request);
        if ($latLonError !== null) {
            return $latLonError;
        }

        $takenAt = $request->post('takenAt');
        if ($takenAt !== null && $takenAt !== '') {
            $parsed = strtotime($takenAt);
            if ($parsed === false) {
                return JsonResponse::error('invalid_taken_at', 'takenAt must be a parseable date.', 422);
            }
            $takenAt = date('Y-m-d H:i:s', $parsed);
        } else {
            $takenAt = null;
        }

        $cameraMake = $request->post('cameraMake');
        $cameraModel = $request->post('cameraModel');
        $cameraMake = $cameraMake === '' ? null : $cameraMake;
        $cameraModel = $cameraModel === '' ? null : $cameraModel;

        try {
            $processed = $this->imageProcessor->process($tmpPath, $mime, $userId);
        } catch (\RuntimeException $e) {
            return JsonResponse::error('invalid_image', 'The uploaded file could not be processed as an image.', 422);
        }

        $result = $this->quota->reserveAndInsert(
            $userId,
            $processed->totalBytes,
            function () use ($processed, $userId, $lat, $lon, $takenAt, $cameraMake, $cameraModel) {
                return $this->photos->create(
                    $userId,
                    $processed->storagePath,
                    $processed->thumbnailPath,
                    $processed->totalBytes,
                    $lat,
                    $lon,
                    $takenAt,
                    $cameraMake,
                    $cameraModel
                );
            }
        );

        if (!$result['ok']) {
            @unlink($processed->absoluteStoragePath);
            @unlink($processed->absoluteThumbnailPath);

            return new JsonResponse([
                'error' => 'quota_exceeded',
                'message' => 'This account has run out of storage space.',
                'quotaBytes' => $result['quotaBytes'],
                'usedBytes' => $result['usedBytes'],
            ], 413);
        }

        $row = $this->photos->find((int) $result['insertId']);

        return new JsonResponse($this->presenter->toOwnerJson($row), 201);
    }

    public function destroy(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];
        $id = (int) $request->routeParam('id');

        $photo = $this->photos->find($id);
        if ($photo === null || (int) $photo['user_id'] !== $userId) {
            return JsonResponse::error('not_found', 'Photo not found.', 404);
        }

        $deleted = $this->photos->deleteForUser($id, $userId);
        if (!$deleted) {
            return JsonResponse::error('not_found', 'Photo not found.', 404);
        }

        @unlink($this->storagePath . '/' . $photo['storage_path']);
        @unlink($this->storagePath . '/' . $photo['thumbnail_path']);

        return new JsonResponse(['ok' => true]);
    }

    public function update(Request $request): JsonResponse
    {
        $userId = (int) $_SESSION['user_id'];
        $id = (int) $request->routeParam('id');

        $photo = $this->photos->find($id);
        if ($photo === null || (int) $photo['user_id'] !== $userId) {
            return JsonResponse::error('not_found', 'Photo not found.', 404);
        }

        $body = $request->json();
        $latRaw = $body['lat'] ?? null;
        $lonRaw = $body['lon'] ?? null;

        if ($latRaw === null || $lonRaw === null) {
            return JsonResponse::error('invalid_coordinates', 'Both lat and lon are required.', 422);
        }

        if (!is_numeric($latRaw) || !is_numeric($lonRaw)) {
            return JsonResponse::error('invalid_coordinates', 'lat/lon must be numeric.', 422);
        }

        $lat = (float) $latRaw;
        $lon = (float) $lonRaw;

        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
            return JsonResponse::error('invalid_coordinates', 'lat/lon out of range.', 422);
        }

        // Only lat/lon are ever read from the body above — any other fields present (e.g. a
        // client-supplied user_id/storage_path) are simply never looked at, so there is no
        // mass-assignment vector here regardless of what the request body contains.
        $this->photos->updateLocation($id, $userId, $lat, $lon);

        $updated = $this->photos->find($id);

        return new JsonResponse($this->presenter->toOwnerJson($updated));
    }

    /**
     * @return array{0: ?float, 1: ?float, 2: ?JsonResponse}
     */
    private function parseLatLon(Request $request): array
    {
        $latRaw = $request->post('lat');
        $lonRaw = $request->post('lon');

        if (($latRaw === null || $latRaw === '') && ($lonRaw === null || $lonRaw === '')) {
            return [null, null, null];
        }

        if ($latRaw === null || $latRaw === '' || $lonRaw === null || $lonRaw === '') {
            return [null, null, JsonResponse::error('invalid_coordinates', 'Both lat and lon are required together.', 422)];
        }

        if (!is_numeric($latRaw) || !is_numeric($lonRaw)) {
            return [null, null, JsonResponse::error('invalid_coordinates', 'lat/lon must be numeric.', 422)];
        }

        $lat = (float) $latRaw;
        $lon = (float) $lonRaw;

        if ($lat < -90 || $lat > 90 || $lon < -180 || $lon > 180) {
            return [null, null, JsonResponse::error('invalid_coordinates', 'lat/lon out of range.', 422)];
        }

        return [$lat, $lon, null];
    }
}
