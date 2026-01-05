#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Get the script directory and project root
const SCRIPT_DIR = __dirname;
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');

const KERNEL_PKG_PATH = path.join(PROJECT_ROOT, 'core', 'kernel', 'package.json');
const HTML_PATH = path.join(PROJECT_ROOT, 'core', 'kernel', 'index.html');

try {
  // Read the kernel package.json to get the version
  const pkg = JSON.parse(fs.readFileSync(KERNEL_PKG_PATH, 'utf8'));
  const version = pkg.version;

  if (!version) {
    console.error('Error: No version found in package.json');
    process.exit(1);
  }

  // Read the HTML file
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  // Replace the softwareVersion in the JSON-LD structured data
  const updated = html.replace(
    /"softwareVersion":\s*"[^"]+"/,
    `"softwareVersion": "${version}"`
  );

  // Check if the replacement actually changed something
  if (updated === html) {
    console.warn('Warning: softwareVersion not found or already matches version');
  }

  // Write the updated HTML back
  fs.writeFileSync(HTML_PATH, updated, 'utf8');

  console.log(`Successfully updated softwareVersion to ${version} in index.html`);
} catch (error) {
  console.error('Error syncing HTML version:', error.message);
  process.exit(1);
}
