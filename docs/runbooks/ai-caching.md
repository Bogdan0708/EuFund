# AI Prompt Caching Runbook

**Q: How do I turn caching off globally?**
`PATCH /api/v1/admin/feature-flags/prompt_cache_enabled { enabled: false }`. Effective on the next request — the router reads with `bypassCache: true`.

**Q: V3 output drifted after PR 2 — is caching to blame?**
1. Set `prompt_cache_enabled = false`. Replay the session. If drift persists → not caching; investigate V3 normally.
2. If drift stops → translator bug. Revert PR 2 or the offending code change. Reproduce against `anthropic-native.test.ts`.

**Q: Cache hit rate dropped to near-zero on V3.**
- Usually a system-prompt regression. Diff recent `lib/ai/agent/prompt.ts` commits; look for newly interpolated timestamps, UUIDs, user IDs, or request IDs in the cached prefix.
- Check `ai_cache_writes_tokens_total / ai_cache_reads_tokens_total` ratio. High writes + low reads = prompt churning per call.

**Q: Cost went up after ramp.**
- Check `ai_cache_writes_tokens_total`. Cache writes cost 1.25× base input — a churning prompt net-raises cost.
- Compare `PRICING_V1._tableVersion` against current provider pricing pages.

**Q: Anthropic native transport 4xx errors.**
- Verify §7.3 invariant: every `tool_result` pairs with a preceding assistant message containing the matching `tool_use`.
- Verify tool-list stability: if tools are reordered between turns, the `cache_control` on the last tool invalidates every call.
