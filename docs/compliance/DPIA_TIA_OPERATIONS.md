# DPIA/TIA Operations Runbook

## Scope
This runbook covers operational evidence and review cadence for:
- DPIA record (`app/src/lib/legal/dpia.ts`)
- TIA controls for OpenAI/Anthropic cross-border transfers
- ANSPDCP consultation evidence tracking

## Required Evidence Bundle
Store the following per review cycle:
- Current DPIA export with `status='approved'`, `dpoApproval=true`
- TIA notes for each non-EU processor (risk, SCC basis, supplementary controls)
- Contractual safeguards evidence (no-training, retention terms)
- ANSPDCP submission reference and latest correspondence
- Sample audit logs proving consent/withdrawal and AI review controls

Recommended local bundle path: `audit_bundle/compliance/YYYY-MM-DD/`.

## Review Cadence
- Frequency: quarterly operational review
- Triggered checks:
1. Scheduled GitHub workflow (`compliance-review`) weekly
2. Manual pre-release review for major AI/data-flow changes

## Escalation Conditions
Escalate to legal/DPO if any of the following occurs:
- DPIA status not approved
- DPO approval missing
- `nextReviewDate` overdue
- Processor change (new region/vendor) without updated TIA

## Automated Check
Run:
```bash
node scripts/compliance/check-dpia-review.mjs
```

This check fails when DPIA approval/review state is non-compliant.
