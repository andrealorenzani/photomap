<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Controllers\AdminAuthController;

/**
 * Full login()/logout()/me() flow (session handling, rate limiting, CSRF) is covered at the
 * Feature tier (AdminAuthFeatureTest) against a real booted server, since it depends on a
 * genuine active PHP session. This class covers the pure, session-free pieces directly.
 */
final class AdminAuthControllerTest extends TestCase
{
    public function testAdminCredentialIsAOneWayHashVerifiableOnlyViaPasswordVerify(): void
    {
        $hash = password_hash('correct horse battery staple', PASSWORD_DEFAULT);

        $this->assertStringStartsWith('$2y$', $hash);
        $this->assertTrue(password_verify('correct horse battery staple', $hash));
        $this->assertFalse(password_verify('wrong password', $hash));
        // The hash itself never contains the plaintext.
        $this->assertStringNotContainsString('correct horse battery staple', $hash);
    }

    public function testHashNeedsRehashDetectsAnOutdatedAlgorithmCost(): void
    {
        $upToDate = password_hash('whatever', PASSWORD_DEFAULT);
        $this->assertFalse(AdminAuthController::hashNeedsRehash($upToDate));

        $weakHash = password_hash('whatever', PASSWORD_BCRYPT, ['cost' => 4]);
        $this->assertTrue(AdminAuthController::hashNeedsRehash($weakHash));
    }
}
