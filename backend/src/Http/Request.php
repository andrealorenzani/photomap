<?php

declare(strict_types=1);

namespace Photomap\Backend\Http;

final class Request
{
    /** @var array<string, mixed> */
    private array $query;

    /** @var array<string, mixed> */
    private array $post;

    /** @var array<string, mixed> */
    private array $server;

    /** @var array<string, mixed> */
    private array $files;

    /** @var array<string, string> */
    private array $routeParams = [];

    private ?array $jsonBody = null;

    private bool $jsonParsed = false;

    public function __construct(
        array $query,
        array $post,
        array $server,
        array $files,
        private readonly string $rawBody = ''
    ) {
        $this->query = $query;
        $this->post = $post;
        $this->server = $server;
        $this->files = $files;
    }

    public static function fromGlobals(): self
    {
        $rawBody = file_get_contents('php://input') ?: '';

        return new self($_GET, $_POST, $_SERVER, $_FILES, $rawBody);
    }

    public function method(): string
    {
        return strtoupper((string) ($this->server['REQUEST_METHOD'] ?? 'GET'));
    }

    public function path(): string
    {
        $uri = (string) ($this->server['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH);

        return $path !== false && $path !== null ? $path : '/';
    }

    public function query(string $key, ?string $default = null): ?string
    {
        $value = $this->query[$key] ?? $default;

        return $value === null ? null : (string) $value;
    }

    public function post(string $key, ?string $default = null): ?string
    {
        $value = $this->post[$key] ?? $default;

        return $value === null ? null : (string) $value;
    }

    public function header(string $name): ?string
    {
        $key = 'HTTP_' . str_replace('-', '_', strtoupper($name));

        return isset($this->server[$key]) ? (string) $this->server[$key] : null;
    }

    public function file(string $key): ?array
    {
        return $this->files[$key] ?? null;
    }

    public function json(): array
    {
        if (!$this->jsonParsed) {
            $this->jsonParsed = true;
            $decoded = json_decode($this->rawBody, true);
            $this->jsonBody = is_array($decoded) ? $decoded : [];
        }

        return $this->jsonBody ?? [];
    }

    public function setRouteParams(array $params): void
    {
        $this->routeParams = $params;
    }

    public function routeParam(string $key): ?string
    {
        return $this->routeParams[$key] ?? null;
    }

    public function ip(): string
    {
        return (string) ($this->server['REMOTE_ADDR'] ?? '0.0.0.0');
    }
}
