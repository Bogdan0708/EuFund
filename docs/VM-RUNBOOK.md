# VM Runbook

Date: 2026-03-11
Status: required operator runbook for the new FundEU knowledge/data VM, partially reconciled to the live GCP inventory

This document defines the intended role of the new VM and the minimum operational controls required before it is treated as production infrastructure.

The VM is strategically important because FundEU now has stateful AI/data workloads that do not fit cleanly inside request-driven Cloud Run services.

## Live Inventory Snapshot

Known live facts from GCP inventory:
- project: `eufunding`
- VM: `fondeu-qdrant`
- zone: `europe-west2-b`
- machine type: `e2-small`
- status: running
- created: 2026-03-10 15:41:34
- persistent disk: `fondeu-qdrant`
- disk size: 20 GB
- external IP present at time of review
- boot image: `cos-stable-121-18867-381-24`
- runtime mode: container-optimized VM
- container image: `qdrant/qdrant:v1.12.6`
- network: `default`
- subnet: `default`
- internal IP: `10.154.0.3`
- external IP: `34.105.211.8` (ephemeral)
- network tag: `qdrant-server`
- backup schedule: daily snapshot policy `daily-backups`, 04:00 UTC, 7-day retention
- service account: default Compute Engine service account

Immediate implication:
- this host is currently a single-purpose Qdrant container VM, not yet a validated ingestion/reindex runner
- public Qdrant exposure on port `6333` was previously present and has now been removed

## 1. Purpose

The VM is the FundEU knowledge/data plane host.

Its primary responsibilities are:
- host Qdrant
- persist vector data for RAG
- run batch ingestion and reindex jobs
- stage classification/reviewer artifacts
- optionally generate internal Obsidian and NotebookLM export artifacts

The VM is not intended to:
- serve customer web traffic
- replace Cloud Run as the public application runtime
- become a general-purpose undocumented script box

## 2. Required Services

Current observed state:
- Qdrant container is configured as the primary workload
- no evidence has yet been recorded in this repo for additional job runner services on the VM
- disk snapshots are now configured via `daily-backups`
- no operator SSH key inventory is documented

### Mandatory

1. Qdrant
- vector database for FundEU retrieval
- persistent storage on attached disk

2. Job runner or controlled execution environment
- for classification
- for bulk ingestion
- for reindex jobs
- for reviewer artifact generation

3. System monitoring
- process health
- disk
- memory
- uptime
- backup status

### Optional but recommended

4. Artifact staging area
- reviewed classification outputs
- ingestion manifests
- internal export manifests for Obsidian/NotebookLM

5. Scheduler
- cron/systemd timer or equivalent for repeatable ingestion tasks

## 3. Data Hosted on VM

### Production-stateful data

- Qdrant collections
- collection metadata
- vector indexes

### Operational data

- reviewed classification outputs
- ingestion manifests
- reindex job artifacts
- reviewer sheets

### Internal-only artifacts

- Obsidian export bundles
- NotebookLM upload guide outputs
- notebook source manifests

Rule:
- internal artifacts must be clearly separated from Qdrant production data and from any customer document storage

## 4. Network Policy

Required posture:
- VM should not expose Qdrant publicly to the internet
- only approved services and operators should reach the VM
- inbound access should be tightly scoped

Current operator note:
- the VM still has an external IP, but Qdrant public access on `6333` has been removed at the firewall level
- firewall rule `allow-qdrant-public` was deleted
- firewall rule `allow-qdrant-internal` now restricts ingress on `6333` to `10.8.0.0/28`
- FundEU now reaches Qdrant via the internal address `10.154.0.3`

Recommended access model:
- SSH access restricted to operators
- Qdrant reachable only from:
  - FundEU app runtime if direct retrieval is required
  - controlled operator/admin IPs or VPC paths
  - ingestion jobs running on the VM itself

Do not allow:
- open public Qdrant port
- ad hoc temporary security group/firewall exceptions that are not documented

Immediate hardening actions:
1. decide whether the remaining external IP is still operationally necessary
2. keep ingress restricted to approved internal paths only
3. preserve the internal-only Qdrant path from Cloud Run via the VPC connector
4. move away from the `default` network posture if this host remains production-critical

## 5. Secrets and Credentials

The VM may require:
- `QDRANT_API_KEY`
- `OPENAI_API_KEY` or equivalent embedding provider auth
- database credentials only if ingestion jobs need DB coordination
- any reviewer/publishing credentials required by controlled internal tooling

Rules:
- secrets must not live in committed files
- secrets must not be stored only in shell history
- there must be one documented source of truth for injection or retrieval

## 6. Storage Layout

Suggested structure:

- `/srv/qdrant/`
  - Qdrant persistent storage

- `/srv/fondeu-ingestion/`
  - checked-out ingestion tooling or mounted workdir

- `/srv/fondeu-data/classification/`
  - raw and reviewed classification outputs

- `/srv/fondeu-data/manifests/`
  - ingestion manifests
  - notebook source manifests
  - reviewer logs

- `/srv/fondeu-data/exports/`
  - Obsidian export outputs
  - NotebookLM upload bundles

Rule:
- Qdrant persistence must be isolated from ephemeral job scratch space

## 7. Backup and Restore

### Qdrant

Must have:
- scheduled backup cadence
- retention window
- restore test procedure

Minimum expectation:
- daily backup
- documented restore target
- tested restoration into a non-production location before production sign-off

Current gap:
- no repo-documented Qdrant snapshot/export procedure exists yet
- the disk snapshot schedule exists, but Qdrant-specific restore validation is still required

### Operational artifacts

Back up:
- reviewed classification outputs
- ingestion manifests
- reviewer decisions

Do not rely on:
- “we can regenerate it” unless regeneration is documented, deterministic, and cheap enough

## 8. Operations Model

### Standard activities

1. Ingestion publish
- run classification
- review low-confidence items
- publish approved content to Qdrant

2. Reindex
- run when embedding model changes
- run when chunking strategy changes
- run when metadata schema changes

3. Internal knowledge export
- generate Obsidian notes
- generate NotebookLM guides
- update source manifests

### Forbidden operations

- emergency direct production mutation without an audit trail
- undocumented one-off ingestion into Qdrant
- running “temporary” services that quietly become permanent

## 9. Observability

At minimum, monitor:
- VM uptime
- CPU and memory
- disk usage
- Qdrant process health
- Qdrant latency/error rate
- backup freshness
- job success/failure counts
- ingestion lag

Alerts should exist for:
- low disk
- Qdrant down
- repeated ingestion failures
- stale backups
- reindex job failure

## 10. Recovery Procedure

### If Qdrant is unhealthy

1. confirm process health
2. confirm disk is not full
3. confirm recent changes or deploys
4. restore service if process-level issue
5. restore from backup if data corruption is suspected
6. validate a representative retrieval query from FundEU app

### If ingestion is broken

1. stop further publish attempts
2. preserve current manifests and logs
3. determine whether failure is classification, embeddings, or vector write path
4. re-run on a controlled subset
5. only resume bulk publish after validation

## 11. Ownership and Access

Must be explicitly filled in by operators:
- primary owner
- backup owner
- on-call or escalation path
- SSH access list
- firewall change owner
- backup owner

This runbook is incomplete until those names are assigned.

## 12. Immediate Next Steps

Before the VM is treated as production-ready:
- document the actual hostname/instance id
- document the actual services installed
- document the actual disk mount points
- document the actual backup mechanism
- document the actual network path used by FundEU to reach Qdrant
- validate a full restore drill

Known concrete next steps from current inventory:
- validate the current Qdrant restore procedure against the new disk snapshot policy
- decide whether this VM will remain Qdrant-only or also host controlled ingestion jobs
- decide whether to remove the remaining external IP entirely

## 13. Relationship to Other Docs

This runbook must stay aligned with:
- `docs/SYSTEM-TOPOLOGY.md`
- `docs/RAG-OPERATING-MODEL.md`
- `docs/KNOWLEDGE-OPS.md`
- deploy and production runbooks
