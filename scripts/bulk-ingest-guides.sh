#!/bin/bash
# ─── Bulk Funding Guide Ingestor ──────────────────────────────────
# Usage: ./bulk-ingest-guides.sh <folder_path> <program_code> <session_token>
# Example: ./bulk-ingest-guides.sh ./my_guides PNRR your-token-here

FOLDER=$1
PROGRAM=$2
TOKEN=$3
# Default to localhost for dev, override via API_URL env var
API_URL=${API_URL:-"http://localhost:3000/api/admin/ingest-call"}

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

if [ -z "$FOLDER" ] || [ -z "$PROGRAM" ] || [ -z "$TOKEN" ]; then
    echo -e "${RED}Error: Missing arguments.${NC}"
    echo "Usage: $0 <folder_path> <program_code> <session_token>"
    exit 1
fi

if [ ! -d "$FOLDER" ]; then
    echo -e "${RED}Error: Folder $FOLDER does not exist.${NC}"
    exit 1
fi

echo -e "${YELLOW}🚀 Starting bulk ingestion for program: $PROGRAM${NC}"
echo "----------------------------------------------------------"

for file in "$FOLDER"/*.{pdf,docx,xlsx}; do
    # check if file exists (handle case where no files match glob)
    [ -e "$file" ] || continue
    
    filename=$(basename "$file")
    echo -ne "📦 Ingesting: $filename ... "

    # Send to API
    # Note: We use the session token in a cookie as next-auth typically looks there
    response=$(curl -s -X POST "$API_URL" \
        -H "Cookie: next-auth.session-token=$TOKEN" \
        -F "file=@$file" \
        -F "programCode=$PROGRAM")

    # Check response
    if echo "$response" | grep -q '"success":true'; then
        call_code=$(echo "$response" | grep -oP '(?<="callCode":")[^"]*')
        echo -e "${GREEN}SUCCESS${NC} (Extracted: $call_code)"
    else
        error_msg=$(echo "$response" | grep -oP '(?<="error":")[^"]*')
        echo -e "${RED}FAILED${NC} ($error_msg)"
    fi
done

echo "----------------------------------------------------------"
echo -e "${GREEN}✅ Bulk ingestion complete!${NC}"
