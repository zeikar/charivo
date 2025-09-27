#!/bin/sh

# Setup script for installing pre-commit hooks

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "${YELLOW}🔧 Setting up pre-commit hooks for charivo...${NC}"

# Get the root directory of the git repository
REPO_ROOT=$(git rev-parse --show-toplevel)

# Check if we're in a git repository
if [ ! -d "$REPO_ROOT/.git" ]; then
    echo "${RED}❌ Not a git repository${NC}"
    exit 1
fi

# Copy the pre-commit hook
HOOK_SOURCE="$REPO_ROOT/scripts/pre-commit"
HOOK_DEST="$REPO_ROOT/.git/hooks/pre-commit"

if [ ! -f "$HOOK_SOURCE" ]; then
    echo "${RED}❌ Pre-commit hook script not found at $HOOK_SOURCE${NC}"
    exit 1
fi

cp "$HOOK_SOURCE" "$HOOK_DEST"
chmod +x "$HOOK_DEST"

echo "${GREEN}✅ Pre-commit hook installed successfully!${NC}"
echo ""
echo "${YELLOW}📝 What this hook does:${NC}"
echo "  - Runs ESLint on staged JS/TS files"
echo "  - Checks Prettier formatting on staged files"
echo "  - Runs TypeScript type checking"
echo ""
echo "${YELLOW}💡 To bypass the hook (not recommended):${NC}"
echo "  git commit --no-verify -m \"your message\""
echo ""
echo "${GREEN}🎉 You're all set! The hook will run automatically on your next commit.${NC}"