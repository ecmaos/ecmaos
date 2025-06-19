#!/bin/sh

set -e

echo "Installing Emscripten SDK (emsdk)..."

if [ -d "emsdk" ]; then
    echo "emsdk directory already exists, updating..."
    cd emsdk
    git pull
else
    echo "Cloning emsdk repository..."
    git clone https://github.com/emscripten-core/emsdk.git
    cd emsdk
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
