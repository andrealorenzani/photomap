<?php

declare(strict_types=1);

namespace Photomap\Backend\Tests\Support;

use Photomap\Backend\Services\MailerInterface;

/**
 * Always throws — used to prove mail is a best-effort side effect, never a transaction
 * participant: a mail failure must never prevent the DB row it's reporting on from being
 * correctly created/activated/disabled.
 */
final class FailingFakeMailer implements MailerInterface
{
    public int $attempts = 0;

    public function send(string $toAddress, string $subject, string $body): void
    {
        $this->attempts++;

        throw new \RuntimeException('Simulated mail transport failure.');
    }
}
