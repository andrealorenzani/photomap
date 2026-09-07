<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

/**
 * A static, hardcoded, curated list of well-known disposable/throwaway email domains, used to
 * reject registration from the most common "burner" email providers as one layer of the
 * anti-spam stack (alongside the honeypot, timing check, and per-IP rate limit). Deliberately
 * NOT admin-configurable in this release -- a reasonable future extension point, not required
 * for this request. Matching is case-insensitive and includes subdomains (e.g.
 * "sub.mailinator.com" matches "mailinator.com").
 */
final class DisposableEmailDomainList
{
    /** @var string[] */
    private const DOMAINS = [
        'mailinator.com',
        'guerrillamail.com',
        'guerrillamail.info',
        'guerrillamail.biz',
        'guerrillamail.de',
        '10minutemail.com',
        '10minutemail.net',
        'yopmail.com',
        'yopmail.fr',
        'yopmail.net',
        'tempmail.com',
        'temp-mail.org',
        'throwawaymail.com',
        'sharklasers.com',
        'maildrop.cc',
        'dispostable.com',
        'getnada.com',
        'trashmail.com',
        'trashmail.net',
        'fakeinbox.com',
        'mailnesia.com',
        'mintemail.com',
        'mytemp.email',
        'moakt.com',
        'spamgourmet.com',
        'spam4.me',
        'mailcatch.com',
        'mail-temporaire.fr',
        'burnermail.io',
        'emailondeck.com',
        'discard.email',
        'discardmail.com',
        'anonbox.net',
        'tempail.com',
        'tempinbox.com',
        'fake-mail.net',
        'mohmal.com',
        'inboxbear.com',
        'crazymailing.com',
        'mailsac.com',
        '33mail.com',
        'jetable.org',
        'harakirimail.com',
        'trbvm.com',
        'einrot.com',
        'wegwerfmail.de',
        'wegwerfmail.net',
        'wegwerfmail.org',
        'nada.email',
    ];

    /** @var array<string, true>|null */
    private static ?array $lookup = null;

    public function isDisposable(string $email): bool
    {
        $atPos = strrpos($email, '@');
        if ($atPos === false) {
            return false;
        }

        $domain = strtolower(substr($email, $atPos + 1));
        if ($domain === '') {
            return false;
        }

        $lookup = self::lookup();

        // Exact match, or a subdomain of a listed domain (e.g. "sub.mailinator.com").
        if (isset($lookup[$domain])) {
            return true;
        }

        foreach ($lookup as $listedDomain => $_) {
            if (str_ends_with($domain, '.' . $listedDomain)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array<string, true>
     */
    private static function lookup(): array
    {
        if (self::$lookup === null) {
            self::$lookup = array_fill_keys(self::DOMAINS, true);
        }

        return self::$lookup;
    }
}
