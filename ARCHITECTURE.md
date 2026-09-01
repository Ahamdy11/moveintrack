# Moveintrack Architecture

```text
Internal / External Browser
          |
          | HTTPS 443
          v
   Caddy Reverse Proxy
  - TLS certificates
  - compression
  - security headers
          |
          | private Docker network
          v
  FastAPI Application
  - authentication
  - CSRF validation
  - RBAC authorization
  - journey workflow
  - risk calculation
  - background overdue monitor
  - audit logging
          |
          v
      PostgreSQL
  - users and sessions
  - journeys and approvals
  - resources and compliance
  - notifications and audit
```

## Deployment Model

- Single application instance is sufficient for approximately 25 users.
- PostgreSQL data is stored in a persistent Docker volume.
- The application container is not exposed directly to the internet.
- Only Caddy publishes ports 80 and 443.
- The same FQDN should resolve internally and externally.

## Authentication

Users authenticate with individual email/password accounts because the requested environment does not use a shared Windows Domain. Sessions are stored server-side and identified by a random HttpOnly cookie. The browser cannot read the session cookie.

## Workflow

```text
Draft -> Pending Approval -> Approved -> Departed -> Arrived -> Closed
              |                  |
              |                  +-> Cancelled
              +-> Returned / Rejected
Departed -> Suspended -> Departed / Cancelled
```

High-risk journeys require two stages:

1. Approver.
2. HSE.

The requester cannot approve their own journey.

## Data Integrity

- Unique journey numbers, emails, vehicle plates, and driver names.
- Optimistic version checks prevent silent overwrites.
- Foreign keys prevent deletion of referenced drivers and vehicles.
- Resource time conflicts are checked before submission.
- Required documents are validated against the planned departure date.
