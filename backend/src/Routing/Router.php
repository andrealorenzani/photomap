<?php

declare(strict_types=1);

namespace Photomap\Backend\Routing;

use Photomap\Backend\Http\JsonResponse;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Http\Response;

final class Router
{
    /**
     * @var array<int, array{method: string, pattern: string, regex: string, params: string[],
     *      handler: callable, middleware: callable[]}>
     */
    private array $routes = [];

    /**
     * @param callable[] $middleware Middleware run before the handler, in order. Each
     *      middleware is `function(Request $request): ?Response` — returning a Response
     *      short-circuits the chain, returning null continues to the next middleware/handler.
     */
    public function add(string $method, string $pattern, callable $handler, array $middleware = []): void
    {
        [$regex, $params] = self::compile($pattern);

        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => $pattern,
            'regex' => $regex,
            'params' => $params,
            'handler' => $handler,
            'middleware' => $middleware,
        ];
    }

    public function get(string $pattern, callable $handler, array $middleware = []): void
    {
        $this->add('GET', $pattern, $handler, $middleware);
    }

    public function post(string $pattern, callable $handler, array $middleware = []): void
    {
        $this->add('POST', $pattern, $handler, $middleware);
    }

    public function delete(string $pattern, callable $handler, array $middleware = []): void
    {
        $this->add('DELETE', $pattern, $handler, $middleware);
    }

    public function patch(string $pattern, callable $handler, array $middleware = []): void
    {
        $this->add('PATCH', $pattern, $handler, $middleware);
    }

    public function put(string $pattern, callable $handler, array $middleware = []): void
    {
        $this->add('PUT', $pattern, $handler, $middleware);
    }

    public function dispatch(Request $request): Response
    {
        $method = $request->method();
        $path = rtrim($request->path(), '/');
        if ($path === '') {
            $path = '/';
        }

        $pathMatchedAnyMethod = false;

        foreach ($this->routes as $route) {
            if (!preg_match($route['regex'], $path, $matches)) {
                continue;
            }

            $pathMatchedAnyMethod = true;

            if ($route['method'] !== $method) {
                continue;
            }

            $params = [];
            foreach ($route['params'] as $name) {
                $params[$name] = $matches[$name] ?? null;
            }
            $request->setRouteParams($params);

            foreach ($route['middleware'] as $middleware) {
                $result = $middleware($request);
                if ($result instanceof Response) {
                    return $result;
                }
            }

            $response = ($route['handler'])($request);
            if (!$response instanceof Response) {
                throw new \RuntimeException('Route handler must return a Response instance.');
            }

            return $response;
        }

        if ($pathMatchedAnyMethod) {
            return JsonResponse::error('method_not_allowed', 'Method not allowed for this route.', 405);
        }

        return JsonResponse::error('not_found', 'Route not found.', 404);
    }

    /**
     * Compiles a pattern like "/api/photos/{id}" into a named-group regex.
     *
     * @return array{0: string, 1: string[]}
     */
    private static function compile(string $pattern): array
    {
        $paramNames = [];

        $regex = preg_replace_callback(
            '#\{([a-zA-Z_][a-zA-Z0-9_]*)\}#',
            static function (array $m) use (&$paramNames): string {
                $paramNames[] = $m[1];

                return '(?P<' . $m[1] . '>[^/]+)';
            },
            $pattern
        );

        return ['#^' . $regex . '$#', $paramNames];
    }
}
