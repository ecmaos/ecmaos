#!/bin/sh

set -e

echo "Installing Emscripten SDK (emsdk)..."

if [ -n "$SKIP_BUILD_BIOS" ]; then
    exit 0
fi

if [ -d "$HOME/emsdk" ]; then
    echo "emsdk directory already exists, updating..."
    cd "$HOME/emsdk"
    git pull
else
    echo "Cloning emsdk repository..."
    git clone https://github.com/emscripten-core/emsdk.git "$HOME/emsdk"
    cd "$HOME/emsdk"
fi

echo "Installing latest SDK tools..."
./emsdk install latest

echo "Activating latest SDK..."
./emsdk activate latest

echo "Setting up environment variables..."
source ./emsdk_env.sh

echo "Verifying installation..."
emcc --version

echo "emsdk installation completed successfully!"
