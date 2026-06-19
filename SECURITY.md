# Security Policy

## Supported versions

The latest released version receives security fixes. This is a small, single-purpose
browser extension; older versions are not maintained.

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.
Use GitHub's **Report a vulnerability** (Security Advisories) on the repository,
or contact the maintainer directly through their GitHub profile.

Include enough detail to reproduce the issue. You can expect an initial response
within a reasonable time, and coordinated disclosure once a fix is available.

## Scope

Relevant areas for this extension:

- Cross-site scripting via rendered news content.
- URL-validation bypasses that could open a non-`dtf.ru` destination.
- Leakage or corruption of locally persisted queue state.

The extension has no backend, no content scripts, no remote code, and no broad host
permissions; it only reads `https://api.dtf.ru/*` using the browser's existing DTF
session.
