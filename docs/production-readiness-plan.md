# Production Readiness Plan

This document converts the project review into an execution program for making FondEU production-ready for consultants and end users on GCP.

## Workstreams

### 1. Security and Access Control
- Protect operational endpoints, admin surfaces, and export flows.
- Standardize authentication and tenant authorization patterns.
- Hash one-time tokens at rest and tighten secret handling.
- Add abuse controls and route-level security regression tests.

### 2. Core Product Logic and Billing
- Remove demo and placeholder behavior from user-facing flows.
- Align pricing, quotas, and feature access with the business model.
- Formalize project, approval, and consultant collaboration workflows.
- Make critical writes transactional and auditable.

### 3. Funding Data and AI Reliability
- Establish a validated source-of-truth pipeline for calls and guides.
- Separate deterministic checks from advisory AI output.
- Attach provenance, freshness, and review state to AI-assisted results.
- Add regression datasets for Romanian funding and compliance cases.

### 4. Platform Ops and Release Engineering
- Harden GCP environments, secrets, networking, and backups.
- Define release gates, smoke tests, SLOs, and alerting.
- Add staging promotion criteria and rollback procedures.
- Verify migrations and dependency health before deployment.

## Phase Order

### P0: Trust and Exposure
- Lock down `/api/metrics` and reduce anonymous `/api/health` output.
- Remove production demo fallbacks from grant matching.
- Hash verification and reset tokens.
- Fix incorrect AI oversight organization routing.
- Make registration and organization creation transactional.

### P1: Commercial and Tenant Correctness
- Enforce paid entitlements server-side.
- Unify organization type and eligibility semantics.
- Review all tenant-sensitive routes for consistent authorization.
- Align Stripe pricing and app plan definitions with the intended business model.

### P2: Operational Maturity
- Harden GCP deployment topology and secret management.
- Expand integration and e2e coverage for consultant-critical flows.
- Add data freshness, ingestion review, and AI provenance controls.
- Introduce release promotion rules and production runbooks.

## Acceptance Criteria

### P0 Done
- No public operational endpoint leaks detailed runtime metadata.
- No user-facing path returns fabricated funding data.
- All one-time account tokens are non-recoverable from DB contents.
- AI oversight records are attached to the correct org context.
- Registration and org creation cannot partially succeed.

### P1 Done
- Feature access matches the subscribed plan.
- Eligibility inputs and stored call constraints use one canonical model.
- Tenant boundaries are validated by tests for all sensitive routes.
- Pricing is consistent across docs, UI, billing, and backend behavior.

### P2 Done
- Staging and production have repeatable deploy and rollback procedures.
- Release gates cover lint, typecheck, unit, integration, and e2e smoke tests.
- Monitoring and alerting are actionable for the live GCP service.
- Funding data freshness and AI provenance are visible and auditable.
