<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Feature;

use Photomap\Backend\Tests\Support\FeatureTestCase;
use Photomap\Backend\Tests\Support\ServerProcess;

final class CsrfFeatureTest extends FeatureTestCase
{
    protected static ?ServerProcess $server = null;

    public function testRegisterRejectsMissingOrInvalidCsrf(): void
    {
        $missing = $this->http->postJson('/api/register', ['email' => 'a@example.com', 'password' => 'password123']);
        $this->assertSame(403, $missing->status);

        $invalid = $this->http->postJson('/api/register', ['email' => 'a@example.com', 'password' => 'password123'], ['X-CSRF-Token: bogus']);
        $this->assertSame(403, $invalid->status);
    }

    public function testLoginRejectsMissingOrInvalidCsrf(): void
    {
        $missing = $this->http->postJson('/api/login', ['email' => 'a@example.com', 'password' => 'password123']);
        $this->assertSame(403, $missing->status);
    }

    public function testLogoutRejectsMissingCsrf(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $response = $this->http->postJson('/api/logout', []);
        $this->assertSame(403, $response->status);
    }

    public function testDeleteAccountRejectsMissingCsrf(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $response = $this->http->delete('/api/account');
        $this->assertSame(403, $response->status);
    }

    public function testPhotoUploadAndDeleteRequireCsrf(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $upload = $this->http->postMultipart('/api/photos', [], ['photo' => $this->fixturePath('small-800x600.jpg')]);
        $this->assertSame(403, $upload->status);

        $uploadOk = $this->http->postMultipart('/api/photos', ['lat' => '1.0', 'lon' => '2.0'], ['photo' => $this->fixturePath('small-800x600.jpg')], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $uploadOk->status);
        $photoId = $uploadOk->json()['id'];

        $deleteNoCsrf = $this->http->delete('/api/photos/' . $photoId);
        $this->assertSame(403, $deleteNoCsrf->status);

        $deleteOk = $this->http->delete('/api/photos/' . $photoId, ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $deleteOk->status);
    }

    public function testShareLinkCreateAndRevokeRequireCsrf(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $createNoCsrf = $this->http->postJson('/api/share-links', []);
        $this->assertSame(403, $createNoCsrf->status);

        $createOk = $this->http->postJson('/api/share-links', [], ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(201, $createOk->status);
        $id = $createOk->json()['id'];

        $revokeNoCsrf = $this->http->delete('/api/share-links/' . $id);
        $this->assertSame(403, $revokeNoCsrf->status);

        $revokeOk = $this->http->delete('/api/share-links/' . $id, ['X-CSRF-Token: ' . $csrf]);
        $this->assertSame(200, $revokeOk->status);
    }

    public function testGetEndpointsNeedNoCsrfToken(): void
    {
        [$userId, $email, $csrf] = $this->registerAndLogin();

        $this->assertSame(200, $this->http->get('/api/me')->status);
        $this->assertSame(200, $this->http->get('/api/photos')->status);
        $this->assertSame(200, $this->http->get('/api/csrf-token')->status);
    }
}
