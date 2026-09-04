<?php

declare(strict_types=1);

namespace Photomap\Backend\Http;

final class JsonResponse extends Response
{
    public function __construct(array $data, int $status = 200)
    {
        parent::__construct((string) json_encode($data, JSON_UNESCAPED_SLASHES), $status);
        $this->withHeader('Content-Type', 'application/json');
    }

    public static function error(string $code, string $message, int $status): self
    {
        return new self(['error' => $code, 'message' => $message], $status);
    }
}
