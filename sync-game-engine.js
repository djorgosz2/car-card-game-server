#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Files to sync
const filesToSync = [
  {
    source: path.join(__dirname, 'shared', 'game-engine.ts'),
    target: path.join(__dirname, '..', 'newfrontend', 'src', 'utils', 'shared', 'game-engine.ts'),
    name: 'game-engine.ts'
  },
  {
    source: path.join(__dirname, 'shared', 'interfaces.ts'),
    target: path.join(__dirname, '..', 'newfrontend', 'src', 'utils', 'shared', 'interfaces.ts'),
    name: 'interfaces.ts'
  }
];

let successCount = 0;
let failCount = 0;

filesToSync.forEach(({ source, target, name }) => {
  try {
    // Check if source exists
    if (!fs.existsSync(source)) {
      console.error(`❌ Source file not found: ${source}`);
      failCount++;
      return;
    }

    // Create target directory if it doesn't exist
    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Copy file
    fs.copyFileSync(source, target);
    
    console.log(`✅ Synced ${name}`);
    console.log(`   From: ${source}`);
    console.log(`   To:   ${target}`);
    successCount++;
  } catch (error) {
    console.error(`❌ Error syncing ${name}:`, error.message);
    failCount++;
  }
});

// Summary
console.log(`\n📊 Summary: ${successCount} synced, ${failCount} failed`);

if (failCount > 0) {
  process.exit(1);
}

