#!/bin/bash
# Install gitleaks pre-commit hook
set -e

echo "=== Installing Gitleaks Pre-Commit Hook ==="

# Check if gitleaks is installed
if ! command -v gitleaks &> /dev/null; then
    echo "Installing gitleaks..."
    if command -v brew &> /dev/null; then
        brew install gitleaks
    elif command -v apt-get &> /dev/null; then
        sudo apt-get update && sudo apt-get install -y gitleaks
    else
        echo "Install gitleaks manually: https://github.com/gitleaks/gitleaks#installing"
        exit 1
    fi
fi

# Create pre-commit hook
HOOK_PATH=".git/hooks/pre-commit"
cat > "$HOOK_PATH" << 'EOF'
#!/bin/bash
# Gitleaks pre-commit hook
echo "Running gitleaks scan..."
gitleaks protect --staged --config=.gitleaks.toml --verbose
if [ $? -ne 0 ]; then
    echo "❌ Secrets detected! Commit blocked."
    echo "Fix the issues above or use --no-verify to bypass (not recommended)."
    exit 1
fi
echo "✅ No secrets found."
EOF

chmod +x "$HOOK_PATH"
echo "✅ Pre-commit hook installed at $HOOK_PATH"
echo "Gitleaks will scan staged files before each commit."
