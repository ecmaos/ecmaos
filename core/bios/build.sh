#!/bin/bash

if [ -n "$SKIP_BUILD_BIOS" ]; then
  exit 0
fi

# Ensure EMSDK is set
if [ -z "$EMSDK" ]; then
  # echo "Error: EMSDK environment variable not set"
  # echo "Please install and activate emscripten first"
  # exit 1
  echo "EMSDK environment variable not set, skipping build"
  exit 0
fi

mkdir -p build
cd build

emcmake cmake ..
emmake make

echo "Build complete! Output files in build/dist/"
