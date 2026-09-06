<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\HttpClient;
use Photomap\Backend\Tests\Support\ServerProcess;

final class ShareLinksFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testCreateShareLinkAndFetchWithZeroCookies(): void
    {
        [, $email, $csrf] = $this->registerAndLogin();
        $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);

        $create = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $create->status);
        $token = $create->json()['token'];
        $this->assertSame(43, strlen($token));

        $anonymous = new HttpClient(static::$server->baseUrl);
        $shareResponse = $anonymous->get('/api/share/' . $token);
        $this->assertSame(200, $shareResponse->status);

        $photos = $shareResponse->json()['photos'];
        $this->assertCount(1, $photos);
        $this->assertStringNotContainsString($email, $shareResponse->body);
        $this->assertStringNotContainsString('password', strtolower($shareResponse->body));

        $imageUrl = $photos[0]['previewUrl'];
        $imageResponse = $anonymous->get($imageUrl);
        $this->assertSame(200, $imageResponse->status);
        $this->assertSame('image/jpeg', $imageResponse->header('Content-Type'));
    }

    public function testRotatingReplacesThePreviousActiveLink(): void
    {
        [, , $csrf] = $this->registerAndLogin();

        $first = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $firstToken = $first->json()['token'];

        $second = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $secondToken = $second->json()['token'];

        $this->assertNotSame($firstToken, $secondToken);

        $anonymous = new HttpClient(static::$server->baseUrl);
        $this->assertSame(404, $anonymous->get('/api/share/' . $firstToken)->status);
        $this->assertSame(200, $anonymous->get('/api/share/' . $secondToken)->status);
    }

    public function testRevokeImmediatelyInvalidatesShareLinkAndItsImageUrls(): void
    {
        [, , $csrf] = $this->registerAndLogin();
        $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);

        $create = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $token = $create->json()['token'];
        $id = $create->json()['id'];

        $anonymous = new HttpClient(static::$server->baseUrl);
        $shareResponse = $anonymous->get('/api/share/' . $token);
        $imageUrl = $shareResponse->json()['photos'][0]['previewUrl'];

        // Fetch once successfully before revocation.
        $this->assertSame(200, $anonymous->get($imageUrl)->status);

        $revoke = $this->http->delete('/api/share-links/' . $id, ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $revoke->status);

        $this->assertSame(404, $anonymous->get('/api/share/' . $token)->status);

        // The previously-obtained share-context image URL must now also be rejected —
        // revocation is checked fresh on every media fetch, not just at token-issuance time.
        $this->assertSame(403, $anonymous->get($imageUrl)->status);
    }

    public function testUserCannotRevokeAnotherUsersShareLink(): void
    {
        [, , $csrfA] = $this->registerAndLogin();
        $create = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrfA]);
        $id = $create->json()['id'];

        [, , $csrfB] = $this->registerAndLogin();
        $revokeAsB = $this->http->delete('/api/share-links/' . $id, ['X-CSRF-Token: ' . $csrfB]);
        $this->assertSame(404, $revokeAsB->status);

        // Still active for the owner / anonymous fetchers.
        $token = $create->json()['token'];
        $anonymous = new HttpClient(static::$server->baseUrl);
        $this->assertSame(200, $anonymous->get('/api/share/' . $token)->status);
    }

    public function testRevokedOrUnknownTokenReturnsGeneric404(): void
    {
        $anonymous = new HttpClient(static::$server->baseUrl);
        $response = $anonymous->get('/api/share/' . str_repeat('a', 43));
        $this->assertSame(404, $response->status);
    }
}
