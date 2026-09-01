# Go-Live Checklist

## Infrastructure

- [ ] Server name is `moveintrack` and has a fixed internal IP.
- [ ] Public FQDN is approved.
- [ ] Internal and external DNS are tested.
- [ ] Port 443 reaches Caddy; application port 8000 is not public.
- [ ] TLS certificate is valid and renews automatically.
- [ ] Server time and timezone are correct.
- [ ] Monitoring is enabled for CPU, memory, storage and container health.

## Application

- [ ] Initial Admin password changed.
- [ ] At least two Admin accounts exist.
- [ ] MFA is enabled for all active users and set to Mandatory.
- [ ] Approver, HSE, Control, Creator and Viewer roles tested.
- [ ] Workspace name, prefix and check-in policy approved.
- [ ] One valid vehicle and one valid driver exist.
- [ ] Go-Live Readiness shows 100%.
- [ ] Self-approval is blocked.
- [ ] High-risk dual approval is tested.
- [ ] Invalid/expired driver and vehicle submission is blocked.
- [ ] Conflict detection is tested.
- [ ] Check-in overdue notification is tested.
- [ ] CSV export is tested.
- [ ] Audit trail contains all expected actions.

## Recovery

- [ ] Daily backup task is scheduled.
- [ ] Backup copy is sent off-server.
- [ ] Restore test has been completed and documented.
- [ ] RPO and RTO are approved by management.

## Governance

- [ ] Data owner is assigned.
- [ ] System owner is assigned.
- [ ] Support contacts and escalation path are published.
- [ ] UAT is signed by Logistics, HSE, Control Room and IT.
- [ ] Production change window is approved.
- [ ] Rollback plan is approved.
