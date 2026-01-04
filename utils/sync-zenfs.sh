#!/bin/sh

set -e

REPO_URL="https://github.com/zen-fs/core.git"
DOCS_PATH="documentation"
TARGET_DIR="core/kernel/public/initfs/usr/share/docs/@zenfs/core"
TEMP_DIR=$(mktemp -d)

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "REPO_URL: $REPO_URL"
echo "DOCS_PATH: $DOCS_PATH"
echo "TARGET_DIR: $TARGET_DIR"
echo "TEMP_DIR: $TEMP_DIR"
echo "SCRIPT_DIR: $SCRIPT_DIR"
echo "PROJECT_ROOT: $PROJECT_ROOT"

echo "Syncing ZenFS documentation from GitHub..."

# Clean up function
cleanup() {
    if [ -d "$TEMP_DIR" ]; then
        echo "Cleaning up temporary directory..."
        rm -rf "$TEMP_DIR"
    fi
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Change to project root
cd "$PROJECT_ROOT"

# Create target directory if it doesn't exist
mkdir -p "$TARGET_DIR"

# Clone the repository to temporary directory
echo "Cloning zen-fs/core repository..."
git clone --depth 1 --filter=blob:none "$REPO_URL" "$TEMP_DIR"

# Configure sparse checkout to only get the documentation folder
cd "$TEMP_DIR"
git sparse-checkout init --cone
git sparse-checkout set "$DOCS_PATH"

# Copy documentation files to target directory
echo "Copying documentation files..."
if [ ! -d "$DOCS_PATH" ]; then
    echo "Error: Documentation folder not found in repository"
    exit 1
fi

# Check if documentation folder is empty
if [ -z "$(ls -A "$DOCS_PATH" 2>/dev/null)" ]; then
    echo "Warning: Documentation folder appears to be empty"
    exit 1
fi

# Protect against unset or empty variables before removing files
if [ -z "$PROJECT_ROOT" ] || [ -z "$TARGET_DIR" ]; then
    echo "Error: PROJECT_ROOT and TARGET_DIR must be set and non-empty before removing files."
    exit 1
fi

# Double-check to prevent accidental deletion of important directories
if [ "$PROJECT_ROOT/$TARGET_DIR" = "/" ] || [ "$PROJECT_ROOT/$TARGET_DIR" = "" ]; then
    echo "Error: Will not remove top-level or empty path. Aborting."
    exit 1
fi

if [ ! -d "$PROJECT_ROOT/$TARGET_DIR" ]; then
    echo "Error: Target directory $PROJECT_ROOT/$TARGET_DIR does not exist (should have been created); aborting."
    exit 1
fi

# Remove existing files in target directory
rm -rf "$PROJECT_ROOT/$TARGET_DIR"/*

# Copy all files from documentation folder
cp -r "$DOCS_PATH"/* "$PROJECT_ROOT/$TARGET_DIR/"

echo "ZenFS documentation sync completed!"
