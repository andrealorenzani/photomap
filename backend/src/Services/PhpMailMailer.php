<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

/**
 * Thin wrapper over PHP's built-in mail(), not an SMTP library — typical Apache/PHP shared
 * hosting (this project's first-class deploy target) reliably supports mail() with
 * zero extra configuration, while outbound SMTP on arbitrary ports is commonly blocked or
 * requires per-account allowlisting on such hosts. Known, accepted limitation: weaker
 * deliverability (spam-folder risk, no DKIM/SPF/retry control) — acceptable given the low
 * volume (two transactional email types, not bulk).
 *
 * Failures are best-effort: never thrown, only logged via error_log(), so a shared-hosting
 * mail misconfiguration never blocks the triggering user-facing action (registration,
 * activation, deactivation).
 */
final class PhpMailMailer implements MailerInterface
{
    public function __construct(
        private readonly string $fromAddress,
        private readonly string $fromName
    ) {
    }

    public function send(string $toAddress, string $subject, string $body): void
    {
        try {
            $headers = sprintf('From: %s <%s>', $this->encodeHeaderWord($this->fromName), $this->fromAddress);

            $sent = @mail($toAddress, $subject, $body, $headers);
            if (!$sent) {
                error_log("PhpMailMailer: mail() returned false sending to {$toAddress} (subject: {$subject}).");
            }
        } catch (\Throwable $e) {
            error_log('PhpMailMailer: failed to send mail: ' . $e->getMessage());
        }
    }

    private function encodeHeaderWord(string $value): string
    {
        // Best-effort ASCII-safe header encoding; the from-name is always our own configured
        // MAIL_FROM_NAME, never user-controlled input, so this is a light sanity pass only.
        return str_replace(["\r", "\n"], '', $value);
    }
}
