#!/bin/bash
# ─── Security Audit Script ───────────────────────────────────────
# Run comprehensive dependency security checks locally
# Usage: ./scripts/security-audit.sh

set -e

cd "$(dirname "$0")/../app"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         EU Funding Platform - Security Audit              ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create reports directory
REPORT_DIR="../security-reports"
mkdir -p "$REPORT_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo -e "${BLUE}[1/5]${NC} Checking production dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Production dependencies audit
npm audit --production --json > "$REPORT_DIR/audit-prod-${TIMESTAMP}.json" 2>/dev/null || true

PROD_CRITICAL=$(jq '.metadata.vulnerabilities.critical // 0' "$REPORT_DIR/audit-prod-${TIMESTAMP}.json")
PROD_HIGH=$(jq '.metadata.vulnerabilities.high // 0' "$REPORT_DIR/audit-prod-${TIMESTAMP}.json")
PROD_MODERATE=$(jq '.metadata.vulnerabilities.moderate // 0' "$REPORT_DIR/audit-prod-${TIMESTAMP}.json")
PROD_LOW=$(jq '.metadata.vulnerabilities.low // 0' "$REPORT_DIR/audit-prod-${TIMESTAMP}.json")

echo "Production Dependencies:"
echo "  Critical: $PROD_CRITICAL"
echo "  High:     $PROD_HIGH"
echo "  Moderate: $PROD_MODERATE"
echo "  Low:      $PROD_LOW"
echo ""

if [ "$PROD_CRITICAL" -gt 0 ] || [ "$PROD_HIGH" -gt 0 ]; then
  echo -e "${RED}⚠️  Critical or High vulnerabilities found in production dependencies!${NC}"
  npm audit --production
  echo ""
fi

echo -e "${BLUE}[2/5]${NC} Checking all dependencies (including dev)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# All dependencies audit
npm audit --json > "$REPORT_DIR/audit-all-${TIMESTAMP}.json" 2>/dev/null || true

ALL_CRITICAL=$(jq '.metadata.vulnerabilities.critical // 0' "$REPORT_DIR/audit-all-${TIMESTAMP}.json")
ALL_HIGH=$(jq '.metadata.vulnerabilities.high // 0' "$REPORT_DIR/audit-all-${TIMESTAMP}.json")
ALL_MODERATE=$(jq '.metadata.vulnerabilities.moderate // 0' "$REPORT_DIR/audit-all-${TIMESTAMP}.json")
ALL_LOW=$(jq '.metadata.vulnerabilities.low // 0' "$REPORT_DIR/audit-all-${TIMESTAMP}.json")

echo "All Dependencies:"
echo "  Critical: $ALL_CRITICAL"
echo "  High:     $ALL_HIGH"
echo "  Moderate: $ALL_MODERATE"
echo "  Low:      $ALL_LOW"
echo ""

echo -e "${BLUE}[3/5]${NC} Checking for outdated packages..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

npm outdated > "$REPORT_DIR/outdated-${TIMESTAMP}.txt" 2>&1 || true
cat "$REPORT_DIR/outdated-${TIMESTAMP}.txt" || echo "All packages are up to date!"
echo ""

echo -e "${BLUE}[4/5]${NC} Generating comprehensive report..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

REPORT_FILE="$REPORT_DIR/security-report-${TIMESTAMP}.md"

cat > "$REPORT_FILE" << EOF
# Security Audit Report

**Generated:** $(date)
**Project:** EU Funding Platform

---

## Executive Summary

### Production Dependencies
- 🔴 Critical: $PROD_CRITICAL
- 🟠 High: $PROD_HIGH
- 🟡 Moderate: $PROD_MODERATE
- 🔵 Low: $PROD_LOW

### All Dependencies (including dev)
- 🔴 Critical: $ALL_CRITICAL
- 🟠 High: $ALL_HIGH
- 🟡 Moderate: $ALL_MODERATE
- 🔵 Low: $ALL_LOW

---

## Detailed Production Audit

\`\`\`
$(npm audit --production 2>&1 || echo "No vulnerabilities found")
\`\`\`

---

## Outdated Packages

\`\`\`
$(cat "$REPORT_DIR/outdated-${TIMESTAMP}.txt")
\`\`\`

---

## Recommended Actions

1. **Fix Critical & High Vulnerabilities Immediately**
   \`\`\`bash
   npm audit fix --production
   \`\`\`

2. **Review Moderate Vulnerabilities**
   - Check if patches are available
   - Assess risk vs. benefit of updates

3. **Update Outdated Packages**
   \`\`\`bash
   npm update
   \`\`\`

4. **Test After Updates**
   \`\`\`bash
   npm test
   npm run build
   \`\`\`

---

## Automation

- Dependabot is configured for weekly updates
- GitHub Actions runs security scans on all PRs
- Weekly automated scans create issues for new vulnerabilities

EOF

echo "Report saved to: $REPORT_FILE"
echo ""

echo -e "${BLUE}[5/5]${NC} Final assessment..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Exit code based on production vulnerabilities
if [ "$PROD_CRITICAL" -gt 0 ]; then
  echo -e "${RED}❌ FAILED: Critical vulnerabilities found in production dependencies${NC}"
  echo -e "${YELLOW}Run: npm audit fix --production${NC}"
  exit 1
elif [ "$PROD_HIGH" -gt 0 ]; then
  echo -e "${YELLOW}⚠️  WARNING: High severity vulnerabilities found in production dependencies${NC}"
  echo -e "${YELLOW}Run: npm audit fix --production${NC}"
  exit 0  # Don't fail CI, but warn
else
  echo -e "${GREEN}✅ PASSED: No critical or high vulnerabilities in production dependencies${NC}"
  
  if [ "$ALL_CRITICAL" -gt 0 ] || [ "$ALL_HIGH" -gt 0 ]; then
    echo -e "${YELLOW}⚠️  Note: Vulnerabilities exist in dev dependencies${NC}"
  fi
  exit 0
fi
