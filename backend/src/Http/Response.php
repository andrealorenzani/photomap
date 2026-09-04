<?php

declare(strict_types=1);

namespace Photomap\Backend\Http;

class Response
{
    /** @var array<string, string> */
    protected array $headers = [];

    public function __construct(
        protected string $body = '',
        protected int $status = 200
    ) {
    }

    public function withHeader(string $name, string $value): static
    {
        $this->headers[$name] = $value;

        return $this;
    }

    public function send(): void
    {
        http_response_code($this->status);
        foreach ($this->headers as $name => $value) {
            header("{$name}: {$value}");
        }
        echo $this->body;
    }
}
