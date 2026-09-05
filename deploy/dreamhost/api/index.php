<?php

// One-line stub: the only thing making /api/* web-reachable on the domain's docroot. Everything
// else the backend needs (vendor/, src/, config.php, storage/) lives one level outside the
// docroot, in a private sibling directory -- see the README's "Deploying to Dreamhost" section.
//
// PHP's __DIR__ inside the *required* file (backend's public/index.php) is computed from that
// file's own real path, regardless of who require()s it -- so dirname(__DIR__) there still
// correctly resolves to the sibling backend directory below, and public/index.php itself needs
// zero changes to work when required from here.
//
// NOTE: "photomap-backend" is the one thing hardcoded in this stub. If you rename/relocate the
// uploaded backend directory, update the path below to match.
require __DIR__ . '/../../photomap-backend/public/index.php';
