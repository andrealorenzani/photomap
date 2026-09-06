<?php

declare(strict_types=1);

namespace Photomap\Backend\Http;

final class JsonResponse extends Response
{
    public function __construct(array $data, int $status = 200)
    {
        // JSON_PRESERVE_ZERO_FRACTION keeps whole-number floats (e.g. lat/lon 12.0) encoded as
        // "12.0" on the wire instead of silently degrading to the int-looking "12" — without it,
        // a client re-decoding the response gets back a PHP/JS-indistinguishable-but-technically-
        // different int, which trips strict type comparisons in tests (and is inconsistent with
        // every other response where the float happens to have a non-zero fractional part).
        parent::__construct(
            (string) json_encode($data, JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION),
            $status
        );
        $this->withHeader('Content-Type', 'application/json');
    }

    public static function error(string $code, string $message, int $status): self
    {
        return new self(['error' => $code, 'message' => $message], $status);
    }
}
