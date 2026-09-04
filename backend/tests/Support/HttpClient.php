<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

/**
 * A thin curl-based HTTP client used by Feature tests to drive a real booted `php -S`
 * server, so cookies / Set-Cookie headers / multipart uploads / session persistence are
 * exercised for real (not simulated in-process).
 */
final class HttpClient
{
    private string $cookieJar;

    public function __construct(private readonly string $baseUrl)
    {
        $this->cookieJar = tempnam(sys_get_temp_dir(), 'photomap-cookies-');
    }

    public function __destruct()
    {
        if (is_file($this->cookieJar)) {
            @unlink($this->cookieJar);
        }
    }

    public function resetCookies(): void
    {
        @unlink($this->cookieJar);
        touch($this->cookieJar);
    }

    public function get(string $path, array $headers = []): HttpResponse
    {
        return $this->request('GET', $path, null, $headers);
    }

    public function postJson(string $path, array $data, array $headers = []): HttpResponse
    {
        $headers[] = 'Content-Type: application/json';

        return $this->request('POST', $path, (string) json_encode($data), $headers);
    }

    public function delete(string $path, array $headers = []): HttpResponse
    {
        return $this->request('DELETE', $path, null, $headers);
    }

    public function patchJson(string $path, array $data, array $headers = []): HttpResponse
    {
        $headers[] = 'Content-Type: application/json';

        return $this->request('PATCH', $path, (string) json_encode($data), $headers);
    }

    public function options(string $path, array $headers = []): HttpResponse
    {
        return $this->request('OPTIONS', $path, null, $headers);
    }

    /**
     * @param array<string, string> $fields Form fields.
     * @param array<string, string> $files Field name => absolute file path.
     */
    public function postMultipart(string $path, array $fields, array $files, array $headers = []): HttpResponse
    {
        $postFields = $fields;
        foreach ($files as $fieldName => $filePath) {
            $mime = mime_content_type($filePath) ?: 'application/octet-stream';
            $postFields[$fieldName] = new \CURLFile($filePath, $mime, basename($filePath));
        }

        return $this->request('POST', $path, $postFields, $headers, true);
    }

    private function request(string $method, string $path, $body, array $headers, bool $multipart = false): HttpResponse
    {
        $ch = curl_init($this->baseUrl . $path);

        $options = [
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HEADER => false,
            CURLOPT_COOKIEJAR => $this->cookieJar,
            CURLOPT_COOKIEFILE => $this->cookieJar,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_TIMEOUT => 15,
        ];

        if ($body !== null) {
            $options[CURLOPT_POSTFIELDS] = $body;
        }

        $responseHeaders = [];
        $options[CURLOPT_HEADERFUNCTION] = function ($curl, $headerLine) use (&$responseHeaders) {
            $len = strlen($headerLine);
            $parts = explode(':', $headerLine, 2);
            if (count($parts) === 2) {
                $name = strtolower(trim($parts[0]));
                $value = trim($parts[1]);
                $responseHeaders[$name][] = $value;
            }

            return $len;
        };

        curl_setopt_array($ch, $options);

        $body = curl_exec($ch);
        if ($body === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new \RuntimeException("HTTP request failed: {$error}");
        }

        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        return new HttpResponse($status, (string) $body, $responseHeaders);
    }
}
