// ── Tool Auto-Registration ─────────────────────────────────────
// Import all tool modules for their side-effect registration.
// This file must be imported by the runtime and API route to ensure
// all tools are available in production (not just in tests).

import './search-calls'
import './get-call-blueprint'
import './retrieve-call-evidence'
import './refresh-call-freshness'
import './run-eligibility'
import './resolve-call'
import './extract-structure'
import './list-missing-annexes'
import './generate-section'
import './validate-section'
import './validate-application'
import './regenerate-section'
