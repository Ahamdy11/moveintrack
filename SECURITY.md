# Security Controls

Implemented controls:

- HTTPS-only cookies in Production.
- HttpOnly and SameSite=Strict session cookies.
- Server-side sessions stored in the database.
- CSRF token on every state-changing request.
- Scrypt password hashing with an individual random salt.
- Password complexity policy.
- Optional or mandatory TOTP multi-factor authentication.
- One-time recovery codes stored only as hashes.
- Account lockout after repeated failures.
- IP login rate limiting.
- Server-side RBAC; hiding a button is never treated as authorization.
- Self-approval prevention.
- Trusted-host validation.
- Content Security Policy and anti-framing headers.
- SQLAlchemy parameterized database access.
- Permanent audit records including actor, action, entity and IP address.
- Session revocation after administrator password reset.
- No direct publication of the application port.

Before public go-live:

1. Replace all sample passwords.
2. Use a real FQDN and valid TLS certificate.
3. Restrict firewall access to ports 80/443 only.
4. Protect Docker and server administration with MFA/VPN.
5. Apply OS and container security updates.
6. Run vulnerability scanning and penetration testing.
7. Confirm database backup encryption and off-server retention.
8. Review user roles quarterly and immediately after employee departure.

Do not place SMTP, database, or certificate secrets inside source files. Keep them in the server `.env` file with restricted permissions or use the company secret-management platform.
