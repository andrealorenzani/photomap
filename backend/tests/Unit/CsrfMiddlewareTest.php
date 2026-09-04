<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Middleware\CsrfMiddleware;

final class CsrfMiddlewareTest extends TestCase
{
    protected function setUp(): void
    {
        $_SESSION = [];
    }

    private function requestWithHeader(?string $token): Request
    {
        $server = [];
        if ($token !== null) {
            $server['HTTP_X_CSRF_TOKEN'] = $token;
        }

        return new Request([], [], $server, []);
    }

    public function testMissingTokenIsRejected(): void
    {
        $_SESSION['csrf_token'] = 'expected-token';
        $middleware = new CsrfMiddleware();

        $response = $middleware($this->requestWithHeader(null));

        $this->assertNotNull($response);
    }

    public function testInvalidTokenIsRejected(): void
    {
        $_SESSION['csrf_token'] = 'expected-token';
        $middleware = new CsrfMiddleware();

        $response = $middleware($this->requestWithHeader('wrong-token'));

        $this->assertNotNull($response);
    }

    public function testValidTokenPassesThrough(): void
    {
        $_SESSION['csrf_token'] = 'expected-token';
        $middleware = new CsrfMiddleware();

        $response = $middleware($this->requestWithHeader('expected-token'));

        $this->assertNull($response);
    }

    public function testNoSessionTokenAlwaysRejects(): void
    {
        unset($_SESSION['csrf_token']);
        $middleware = new CsrfMiddleware();

        $response = $middleware($this->requestWithHeader('anything'));

        $this->assertNotNull($response);
    }
}
