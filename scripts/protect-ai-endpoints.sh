#!/bin/bash
# ─── Protect AI Endpoints with withAIAuth ─────────────────────────
# Systematically adds authentication to unprotected AI endpoints

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AI_DIR="$PROJECT_ROOT/app/src/app/api/ai"

echo "════════════════════════════════════════════════════════════"
echo " AI Endpoint Security Protection Script"
echo "════════════════════════════════════════════════════════════"
echo ""

# List of AI endpoints that need protection
UNPROTECTED_ENDPOINTS=(
  "match-grants"
  "validate-compliance"
  "generate-proposal"
  "project-analysis"
  "analyze-document"
  "deadline-risk-assessment"
  "optimize-timeline"
  "analyze-consortium"
  "optimize-budget"
  "generate-report"
  "project-health"
  "market-intelligence"
  "recommend-partners"
  "generate-insights"
  "advanced-analytics"
)

# Check each endpoint
echo "📋 Checking AI endpoint security status..."
echo ""

PROTECTED=0
UNPROTECTED=0

for endpoint in "${UNPROTECTED_ENDPOINTS[@]}"; do
  ROUTE_FILE="$AI_DIR/$endpoint/route.ts"

  if [ ! -f "$ROUTE_FILE" ]; then
    echo "⚠️  Warning: $endpoint - route file not found"
    continue
  fi

  # Check if withAIAuth is already used
  if grep -q "withAIAuth" "$ROUTE_FILE"; then
    echo "✅ $endpoint - Already protected"
    ((PROTECTED++))
  else
    echo "🔴 $endpoint - UNPROTECTED"
    ((UNPROTECTED++))
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════"
echo " Summary:"
echo "  Protected: $PROTECTED"
echo "  Unprotected: $UNPROTECTED"
echo "════════════════════════════════════════════════════════════"
echo ""

if [ $UNPROTECTED -eq 0 ]; then
  echo "✅ All AI endpoints are protected!"
  exit 0
fi

echo "⚠️  Found $UNPROTECTED unprotected endpoints"
echo ""
echo "To protect endpoints automatically, run:"
echo "  npm run protect-ai-endpoints"
echo ""
echo "Or manually update each endpoint to wrap handlers with withAIAuth"
echo "Example:"
echo ""
cat << 'EOF'
import { withAIAuth } from '@/lib/middleware/auth';

export async function POST(request: NextRequest) {
  return withAIAuth(request, async (user) => {
    // Your handler code here
    // user.id, user.email, user.tier are available
  });
}
EOF

echo ""
exit 1
