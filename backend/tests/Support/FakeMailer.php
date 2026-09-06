<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

use Photomap\Backend\Services\MailerInterface;

final class FakeMailer implements MailerInterface
{
    /** @var array<int, array{to: string, subject: string, body: string}> */
    public array $sent = [];

    public function send(string $toAddress, string $subject, string $body): void
    {
        $this->sent[] = ['to' => $toAddress, 'subject' => $subject, 'body' => $body];
    }
}
