<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Controllers\AdminUsersController;
use Photomap\Backend\Controllers\AuthController;
use Photomap\Backend\Http\Request;
use Photomap\Backend\Repositories\LoginAttemptRepository;
use Photomap\Backend\Repositories\PhotoRepository;
use Photomap\Backend\Repositories\RegistrationAttemptRepository;
use Photomap\Backend\Repositories\ShareLinkRepository;
use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Services\DisposableEmailDomainList;
use Photomap\Backend\Services\RateLimiter;
use Photomap\Backend\Tests\Support\DatabaseTestCase;
use Photomap\Backend\Tests\Support\FailingFakeMailer;
use Photomap\Backend\Tests\Support\FakeMailer;

/**
 * Mirrors GeocodeControllerTest's Unit-tier pattern: exercises controllers directly (real
 * PDO/DB, fake external side effect) rather than over real HTTP, so mail-sending can be
 * asserted precisely without ever risking a real mail() call.
 */
final class MailNotificationsTest extends DatabaseTestCase
{
    private function jsonRequest(array $body, array $routeParams = []): Request
    {
        $request = new Request([], [], [], [], (string) json_encode($body));
        $request->setRouteParams($routeParams);

        return $request;
    }

    /**
     * Same as jsonRequest(), but merges in a `formRenderedAt` far enough in the past to always
     * clear the registration timing check -- this class tests mail-notification side effects
     * of register(), not the anti-spam checks themselves (see RegistrationHardeningFeatureTest
     * for those), so every register() call here needs to look like a legitimate, un-hurried
     * submission.
     */
    private function registerRequest(array $body, array $routeParams = []): Request
    {
        $body['formRenderedAt'] ??= self::nowMillis() - 10_000;

        return $this->jsonRequest($body, $routeParams);
    }

    private static function nowMillis(): int
    {
        return (int) round(microtime(true) * 1000);
    }

    private function authController(FakeMailer|FailingFakeMailer $mailer, ?string $adminNotifyEmail = 'admin@example.com'): AuthController
    {
        $users = new UserRepository($this->pdo);
        $rateLimiter = new RateLimiter(new LoginAttemptRepository($this->pdo), 5, 900);
        $registrationAttempts = new RegistrationAttemptRepository($this->pdo);
        $disposableEmailDomains = new DisposableEmailDomainList();

        return new AuthController($users, $rateLimiter, $mailer, $registrationAttempts, $disposableEmailDomains, $adminNotifyEmail);
    }

    private function adminUsersController(FakeMailer|FailingFakeMailer $mailer): AdminUsersController
    {
        return new AdminUsersController(
            new UserRepository($this->pdo),
            new PhotoRepository($this->pdo),
            new ShareLinkRepository($this->pdo),
            $mailer
        );
    }

    public function testRegisteringCallsMailerOnceToAdminNotifyEmailWithNewUsersEmail(): void
    {
        $mailer = new FakeMailer();
        $controller = $this->authController($mailer);

        $controller->register($this->registerRequest(['email' => 'newperson@example.com', 'password' => 'password123']));

        $this->assertCount(1, $mailer->sent);
        $this->assertSame('admin@example.com', $mailer->sent[0]['to']);
        $this->assertStringContainsString('newperson@example.com', $mailer->sent[0]['body']);
    }

    public function testNoMailSentOnFailedRegistration(): void
    {
        $mailer = new FakeMailer();
        $controller = $this->authController($mailer);

        $controller->register($this->registerRequest(['email' => 'not-an-email', 'password' => 'password123']));
        $controller->register($this->registerRequest(['email' => 'short@example.com', 'password' => 'short']));

        $this->assertCount(0, $mailer->sent);
    }

    public function testMissingAdminNotifyEmailDegradesToNoOpNotThrow(): void
    {
        $mailer = new FakeMailer();
        $controller = $this->authController($mailer, null);

        $controller->register($this->registerRequest(['email' => 'noop@example.com', 'password' => 'password123']));

        $this->assertCount(0, $mailer->sent);
        $row = $this->pdo->query("SELECT status FROM users WHERE email = 'noop@example.com'")->fetch();
        $this->assertSame('pending', $row['status']);
    }

    public function testFailingMailerDoesNotPreventRegistrationFromCreatingTheRow(): void
    {
        $mailer = new FailingFakeMailer();
        $controller = $this->authController($mailer);

        $response = $controller->register($this->registerRequest(['email' => 'resilient@example.com', 'password' => 'password123']));

        $this->assertSame(1, $mailer->attempts);
        $this->assertSame(201, $this->responseStatus($response));

        $row = $this->pdo->query("SELECT status FROM users WHERE email = 'resilient@example.com'")->fetch();
        $this->assertSame('pending', $row['status']);
    }

    public function testActivatingCallsMailerOnceToTheUsersEmailWithActiveContent(): void
    {
        $users = new UserRepository($this->pdo);
        $userId = $users->create('activateme@example.com', password_hash('irrelevant', PASSWORD_DEFAULT));

        $mailer = new FakeMailer();
        $controller = $this->adminUsersController($mailer);

        $controller->activate($this->jsonRequest(['storageQuotaBytes' => 5000], ['id' => (string) $userId]));

        $this->assertCount(1, $mailer->sent);
        $this->assertSame('activateme@example.com', $mailer->sent[0]['to']);
        $this->assertStringContainsStringIgnoringCase('active', $mailer->sent[0]['subject'] . ' ' . $mailer->sent[0]['body']);
    }

    public function testDisablingCallsMailerOnceWithDeactivatedContent(): void
    {
        $users = new UserRepository($this->pdo);
        $userId = $users->create('disableme@example.com', password_hash('irrelevant', PASSWORD_DEFAULT));
        $users->activate($userId, null);

        $mailer = new FakeMailer();
        $controller = $this->adminUsersController($mailer);

        $controller->disable($this->jsonRequest([], ['id' => (string) $userId]));

        $this->assertCount(1, $mailer->sent);
        $this->assertSame('disableme@example.com', $mailer->sent[0]['to']);
        $this->assertStringContainsStringIgnoringCase('deactivat', $mailer->sent[0]['subject'] . ' ' . $mailer->sent[0]['body']);
    }

    public function testFailingMailerDoesNotPreventActivateFromUpdatingTheRow(): void
    {
        $users = new UserRepository($this->pdo);
        $userId = $users->create('resilientactivate@example.com', password_hash('irrelevant', PASSWORD_DEFAULT));

        $mailer = new FailingFakeMailer();
        $controller = $this->adminUsersController($mailer);

        $response = $controller->activate($this->jsonRequest([], ['id' => (string) $userId]));

        $this->assertSame(1, $mailer->attempts);
        $this->assertSame(200, $this->responseStatus($response));

        $row = $this->pdo->query("SELECT status FROM users WHERE id = {$userId}")->fetch();
        $this->assertSame('active', $row['status']);
    }

    private function responseStatus($jsonResponse): int
    {
        $ref = new \ReflectionProperty($jsonResponse, 'status');
        $ref->setAccessible(true);

        return $ref->getValue($jsonResponse);
    }
}
