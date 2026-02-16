#!/bin/bash
# ─── Security Testing Script ───────────────────────────────────────
# Tests authentication, rate limiting, CSRF protection

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_URL="${API_URL:-http://localhost:3000}"

echo "════════════════════════════════════════════════════════════"
echo " Security Testing Suite"
echo " Target: $API_URL"
echo "════════════════════════════════════════════════════════════"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

run_test() {
  local test_name="$1"
  local expected_status="$2"
  local url="$3"
  shift 3
  local curl_args=("$@")

  ((TESTS_RUN++))

  echo "Test $TESTS_RUN: $test_name"

  response=$(curl -s -w "\n%{http_code}" "${curl_args[@]}" "$url")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" == "$expected_status" ]; then
    echo -e "  ${GREEN}✓ PASS${NC} - Status: $http_code"
    ((TESTS_PASSED++))
  else
    echo -e "  ${RED}✗ FAIL${NC} - Expected: $expected_status, Got: $http_code"
    echo "  Response: $body"
    ((TESTS_FAILED++))
  fi
  echo ""
}

echo "══════════════════════════════════════════════════════════"
echo " Test Suite 1: Authentication"
echo "══════════════════════════════════════════════════════════"
echo ""

# Test 1: Unauthenticated AI endpoint access
run_test \
  "Unauthenticated AI endpoint (should return 401)" \
  "401" \
  "$API_URL/api/ai/match-grants" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"projectIdea": "test", "organization": {"orgType": "srl"}}'

# Test 2: Unauthenticated API access
run_test \
  "Unauthenticated API endpoint (should return 401)" \
  "401" \
  "$API_URL/api/v1/projects" \
  -X GET

# Test 3: Health endpoint (should be public)
run_test \
  "Public health endpoint (should return 200)" \
  "200" \
  "$API_URL/api/health" \
  -X GET

echo "══════════════════════════════════════════════════════════"
echo " Test Suite 2: CSRF Protection"
echo "══════════════════════════════════════════════════════════"
echo ""

# Test 4: POST without CSRF token
run_test \
  "POST without CSRF token (should return 403)" \
  "403" \
  "$API_URL/api/v1/projects" \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"title": "Test", "orgId": "test"}'

# Test 5: POST with CSRF token
run_test \
  "POST with CSRF token (should return 401 due to no auth)" \
  "401" \
  "$API_URL/api/v1/projects" \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: test-token" \
  -d '{"title": "Test", "orgId": "test"}'

echo "══════════════════════════════════════════════════════════"
echo " Test Suite 3: Rate Limiting"
echo "══════════════════════════════════════════════════════════"
echo ""

# Test 6: Rapid requests to trigger rate limit
echo "Test $((TESTS_RUN + 1)): Rate limiting (sending 110 requests)..."
echo "  This may take a moment..."

RATE_LIMIT_HIT=false
for i in {1..110}; do
  response=$(curl -s -w "%{http_code}" "$API_URL/api/health" -o /dev/null)

  if [ "$response" == "429" ]; then
    RATE_LIMIT_HIT=true
    echo -e "  ${GREEN}✓ PASS${NC} - Rate limit triggered at request $i"
    ((TESTS_PASSED++))
    break
  fi
done

((TESTS_RUN++))

if [ "$RATE_LIMIT_HIT" = false ]; then
  echo -e "  ${YELLOW}⚠ SKIP${NC} - Rate limit not triggered (Redis may be unavailable)"
  ((TESTS_FAILED++))
fi
echo ""

echo "══════════════════════════════════════════════════════════"
echo " Test Suite 4: Security Headers"
echo "══════════════════════════════════════════════════════════"
echo ""

# Test 7: Check security headers
echo "Test $((TESTS_RUN + 1)): Security headers"
((TESTS_RUN++))

headers=$(curl -s -I "$API_URL/api/health")

HEADERS_PASSED=true

check_header() {
  local header="$1"
  if echo "$headers" | grep -qi "^$header:"; then
    echo -e "  ${GREEN}✓${NC} $header present"
  else
    echo -e "  ${RED}✗${NC} $header missing"
    HEADERS_PASSED=false
  fi
}

check_header "X-Content-Type-Options"
check_header "X-Frame-Options"
check_header "X-XSS-Protection"
check_header "Referrer-Policy"
check_header "Content-Security-Policy"
check_header "Permissions-Policy"

if [ "$HEADERS_PASSED" = true ]; then
  ((TESTS_PASSED++))
  echo -e "  ${GREEN}✓ PASS${NC} - All security headers present"
else
  ((TESTS_FAILED++))
  echo -e "  ${RED}✗ FAIL${NC} - Some security headers missing"
fi
echo ""

echo "══════════════════════════════════════════════════════════"
echo " Test Suite 5: Protected AI Endpoints"
echo "══════════════════════════════════════════════════════════"
echo ""

AI_ENDPOINTS=(
  "match-grants"
  "validate-compliance"
  "generate-proposal"
  "predict-success"
  "analyze-document"
)

for endpoint in "${AI_ENDPOINTS[@]}"; do
  run_test \
    "Protected AI endpoint: $endpoint (should return 401)" \
    "401" \
    "$API_URL/api/ai/$endpoint" \
    -X POST \
    -H "Content-Type: application/json" \
    -d '{}'
done

echo "════════════════════════════════════════════════════════════"
echo " RESULTS"
echo "════════════════════════════════════════════════════════════"
echo ""
echo "  Total Tests:  $TESTS_RUN"
echo -e "  ${GREEN}Passed:       $TESTS_PASSED${NC}"
echo -e "  ${RED}Failed:       $TESTS_FAILED${NC}"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All security tests passed!${NC}"
  exit 0
else
  echo -e "${RED}❌ Some security tests failed${NC}"
  exit 1
fi
