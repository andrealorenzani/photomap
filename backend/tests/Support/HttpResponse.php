<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

final class HttpResponse
{
    /**
     * @param array<string, string[]> $headers Lowercased header name => list of raw values.
     */
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        public readonly array $headers
    ) {
    }

    public function json(): array
    {
        $decoded = json_decode($this->body, true);

        return is_array($decoded) ? $decoded : [];
    }

    public function header(string $name): ?string
    {
        $values = $this->headers[strtolower($name)] ?? [];

        return $values[0] ?? null;
    }

    /**
     * @return string[] All Set-Cookie header lines (there can be more than one).
     */
    public function setCookieHeaders(): array
    {
        return $this->headers['set-cookie'] ?? [];
    }
}
