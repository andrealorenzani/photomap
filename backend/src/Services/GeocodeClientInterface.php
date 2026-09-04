<?php

declare(strict_types=1);

namespace Photomap\Backend\Services;

interface GeocodeClientInterface
{
    /**
     * Looks up a human-readable place name for the given coordinates.
     * Returns null if no result was found (a valid, cacheable outcome).
     */
    public function lookup(float $lat, float $lon): ?string;
}
