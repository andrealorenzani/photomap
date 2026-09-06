<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use Photomap\Backend\Repositories\UserRepository;
use Photomap\Backend\Tests\Support\DatabaseTestCase;

final class UserRepositoryTest extends DatabaseTestCase
{
    private function repo(): UserRepository
    {
        return new UserRepository($this->pdo);
    }

    public function testCreateDefaultsNewRowsToPending(): void
    {
        $repo = $this->repo();
        $id = $repo->create('newrow@example.com', password_hash('irrelevant', PASSWORD_DEFAULT));

        $row = $repo->findById($id);
        $this->assertSame('pending', $row['status']);
        $this->assertNull($row['storage_quota_bytes']);
        $this->assertNull($row['approved_at']);
    }

    public function testActivateSetsStatusAndQuotaAndApprovedAtOnTheTargetedRowOnly(): void
    {
        $repo = $this->repo();
        $targetId = $repo->create('target@example.com', password_hash('x', PASSWORD_DEFAULT));
        $otherId = $repo->create('other@example.com', password_hash('x', PASSWORD_DEFAULT));

        $repo->activate($targetId, 12345);

        $target = $repo->findById($targetId);
        $this->assertSame('active', $target['status']);
        $this->assertSame(12345, (int) $target['storage_quota_bytes']);
        $this->assertNotNull($target['approved_at']);

        $other = $repo->findById($otherId);
        $this->assertSame('pending', $other['status']);
        $this->assertNull($other['storage_quota_bytes']);
    }

    public function testActivateWithNullQuotaFallsBackToGlobalDefault(): void
    {
        $repo = $this->repo();
        $id = $repo->create('nullquota@example.com', password_hash('x', PASSWORD_DEFAULT));

        $repo->activate($id, null);

        $row = $repo->findById($id);
        $this->assertSame('active', $row['status']);
        $this->assertNull($row['storage_quota_bytes']);
    }

    public function testDisableMutatesOnlyTheTargetedRow(): void
    {
        $repo = $this->repo();
        $targetId = $repo->create('todisable@example.com', password_hash('x', PASSWORD_DEFAULT));
        $otherId = $repo->create('untouched@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->activate($targetId, null);
        $repo->activate($otherId, null);

        $repo->disable($targetId);

        $this->assertSame('disabled', $repo->findById($targetId)['status']);
        $this->assertSame('active', $repo->findById($otherId)['status']);
    }

    public function testSearchByEmailSubstring(): void
    {
        $repo = $this->repo();
        $repo->create('alice@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->create('bob@example.com', password_hash('x', PASSWORD_DEFAULT));

        $results = $repo->search('alice', null, 'created_at', 'desc', 1, 25);

        $this->assertCount(1, $results);
        $this->assertSame('alice@example.com', $results[0]['email']);
    }

    public function testSearchFiltersByStatus(): void
    {
        $repo = $this->repo();
        $activeId = $repo->create('active-user@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->create('pending-user@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->activate($activeId, null);

        $results = $repo->search('', 'active', 'created_at', 'desc', 1, 25);

        $this->assertCount(1, $results);
        $this->assertSame('active-user@example.com', $results[0]['email']);
    }

    public function testSearchSortsByCreatedAtAscAndDesc(): void
    {
        $repo = $this->repo();
        $firstId = $repo->create('first@example.com', password_hash('x', PASSWORD_DEFAULT));
        $this->pdo->exec("UPDATE users SET created_at = '2020-01-01 00:00:00' WHERE id = {$firstId}");
        $secondId = $repo->create('second@example.com', password_hash('x', PASSWORD_DEFAULT));
        $this->pdo->exec("UPDATE users SET created_at = '2021-01-01 00:00:00' WHERE id = {$secondId}");

        $asc = $repo->search('', null, 'created_at', 'asc', 1, 25);
        $this->assertSame('first@example.com', $asc[0]['email']);

        $desc = $repo->search('', null, 'created_at', 'desc', 1, 25);
        $this->assertSame('second@example.com', $desc[0]['email']);
    }

    /**
     * A sort column outside the fixed allow-list must never be interpolated into ORDER BY
     * verbatim — it should silently fall back to the default (created_at) rather than error
     * or execute anything.
     */
    public function testSortColumnAllowListRejectsSqlInjectionShapedInput(): void
    {
        $repo = $this->repo();
        $repo->create('safe@example.com', password_hash('x', PASSWORD_DEFAULT));

        $results = $repo->search('', null, 'id; DROP TABLE users; --', 'asc', 1, 25);

        $this->assertNotEmpty($results);

        $stillExists = $this->pdo->query('SELECT COUNT(*) c FROM users')->fetch();
        $this->assertGreaterThan(0, (int) $stillExists['c']);
    }

    public function testCountMatchesSearchResultsAcrossPages(): void
    {
        $repo = $this->repo();
        for ($i = 0; $i < 5; $i++) {
            $repo->create("user{$i}@example.com", password_hash('x', PASSWORD_DEFAULT));
        }

        $this->assertSame(5, $repo->count('', null));
        $page1 = $repo->search('', null, 'created_at', 'asc', 1, 2);
        $page2 = $repo->search('', null, 'created_at', 'asc', 2, 2);
        $page3 = $repo->search('', null, 'created_at', 'asc', 3, 2);
        $this->assertCount(2, $page1);
        $this->assertCount(2, $page2);
        $this->assertCount(1, $page3);
    }

    public function testCountByStatus(): void
    {
        $repo = $this->repo();
        $a = $repo->create('a@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->create('b@example.com', password_hash('x', PASSWORD_DEFAULT));
        $repo->activate($a, null);

        $counts = $repo->countByStatus();

        $this->assertSame(1, $counts['active']);
        $this->assertSame(1, $counts['pending']);
        $this->assertSame(0, $counts['disabled']);
    }
}
