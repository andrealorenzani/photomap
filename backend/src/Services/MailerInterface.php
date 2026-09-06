<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

/**
 * Mirrors GeocodeClientInterface/NominatimClient/FakeGeocodeClient: an interface over an
 * external side effect that must never fire for real in automated tests.
 */
interface MailerInterface
{
    public function send(string $toAddress, string $subject, string $body): void;
}
