<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Unit;

use PHPUnit\Framework\TestCase;
use Photomap\Backend\Services\DisposableEmailDomainList;

final class DisposableEmailDomainListTest extends TestCase
{
    private DisposableEmailDomainList $list;

    protected function setUp(): void
    {
        parent::setUp();
        $this->list = new DisposableEmailDomainList();
    }

    public function testRejectsKnownDisposableDomains(): void
    {
        $this->assertTrue($this->list->isDisposable('someone@mailinator.com'));
        $this->assertTrue($this->list->isDisposable('someone@guerrillamail.com'));
        $this->assertTrue($this->list->isDisposable('someone@10minutemail.com'));
        $this->assertTrue($this->list->isDisposable('someone@yopmail.com'));
    }

    public function testMatchingIsCaseInsensitive(): void
    {
        $this->assertTrue($this->list->isDisposable('Someone@MAILINATOR.COM'));
        $this->assertTrue($this->list->isDisposable('someone@Mailinator.Com'));
    }

    public function testMatchesSubdomainsOfListedDomains(): void
    {
        $this->assertTrue($this->list->isDisposable('someone@sub.mailinator.com'));
        $this->assertTrue($this->list->isDisposable('someone@deep.sub.mailinator.com'));
    }

    public function testDoesNotFalsePositiveOnUnrelatedDomainsThatMerelyContainAListedDomainAsASubstring(): void
    {
        // "notmailinator.com" is not a subdomain of "mailinator.com" -- must not match on a
        // naive substring/suffix check.
        $this->assertFalse($this->list->isDisposable('someone@notmailinator.com'));
        $this->assertFalse($this->list->isDisposable('someone@mailinator.com.example.org'));
    }

    public function testAllowsOrdinaryNonDisposableDomains(): void
    {
        $this->assertFalse($this->list->isDisposable('someone@example.com'));
        $this->assertFalse($this->list->isDisposable('someone@gmail.com'));
        $this->assertFalse($this->list->isDisposable('someone@company.co.uk'));
    }

    public function testMalformedEmailWithNoAtSignIsNotDisposable(): void
    {
        $this->assertFalse($this->list->isDisposable('not-an-email'));
    }

    public function testEmptyLocalPartOrDomainIsHandledGracefully(): void
    {
        $this->assertFalse($this->list->isDisposable('@'));
        $this->assertFalse($this->list->isDisposable('someone@'));
    }
}
