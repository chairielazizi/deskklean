// scripts/test-phase2-live.mjs
// Live integration tests on Windows for Phase 2 Step 7 (Startup Delay) & Step 8 (Backup/Restore).

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const startup = require('../dist/main/system/startup.js');
const framework = require('../dist/main/system/framework/index.js');
const registry = require('../dist/main/system/registry.js');

let failedCount = 0;
let passedCount = 0;

function assert(condition, name, details = '') {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${name}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${name}`);
    if (details) {
      console.error(`       ${details}`);
    }
  }
}

async function run() {
  console.log('==================================================');
  console.log('LIVE TEST: Step 7 — Global Startup Delay (Registry)');
  console.log('==================================================\n');

  // Record initial state so we can restore it at the end
  const initial = await startup.getStartupDelay();
  console.log('Initial delay state:', initial);

  try {
    // 1. Test setting 0ms (no delay) and waitForIdle = false
    console.log('\n--- Test 1: Set delay 0 ms, waitForIdle = false ---');
    const res1 = await startup.setStartupDelay(0, false);
    assert(res1.success === true, '1a. setStartupDelay(0, false) reports success');

    const read1 = await startup.getStartupDelay();
    assert(read1.delayMs === 0, '1b. getStartupDelay().delayMs === 0 (not null)');
    assert(read1.waitForIdle === false, '1c. getStartupDelay().waitForIdle === false');
    assert(read1.supported === true, '1d. supported === true');

    // Verify directly in Windows Registry via PowerShell
    const psCheck1 = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -ErrorAction SilentlyContinue).StartupDelayInMSec"`
    ).toString().trim();
    assert(psCheck1 === '0', '1e. PowerShell confirms StartupDelayInMSec is 0 in registry');

    const psIdle1 = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -ErrorAction SilentlyContinue).WaitForIdleState"`
    ).toString().trim();
    assert(psIdle1 === '0', '1f. PowerShell confirms WaitForIdleState is 0 in registry');

    // 2. Test setting 5000ms and waitForIdle = true
    console.log('\n--- Test 2: Set delay 5000 ms, waitForIdle = true ---');
    const res2 = await startup.setStartupDelay(5000, true);
    assert(res2.success === true, '2a. setStartupDelay(5000, true) reports success');

    const read2 = await startup.getStartupDelay();
    assert(read2.delayMs === 5000, '2b. getStartupDelay().delayMs === 5000');
    assert(read2.waitForIdle === true, '2c. getStartupDelay().waitForIdle === true');

    const psCheck2 = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -ErrorAction SilentlyContinue).StartupDelayInMSec"`
    ).toString().trim();
    assert(psCheck2 === '5000', '2d. PowerShell confirms StartupDelayInMSec is 5000 in registry');

    const psIdle2 = execSync(
      `powershell -NoProfile -Command "(Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -ErrorAction SilentlyContinue).WaitForIdleState"`
    ).toString().trim();
    assert(psIdle2 === '1', '2e. PowerShell confirms WaitForIdleState is 1 in registry');

    // 3. Test Reset (ms === null) restoring Windows default
    console.log('\n--- Test 3: Reset to Windows default (ms === null) ---');
    const res3 = await startup.setStartupDelay(null, true);
    assert(res3.success === true, '3a. setStartupDelay(null, true) reports success');

    const read3 = await startup.getStartupDelay();
    assert(read3.delayMs === null, '3b. getStartupDelay().delayMs === null (absent)');
    assert(read3.waitForIdle === null, '3c. getStartupDelay().waitForIdle === null (absent)');

    const psCheck3 = execSync(
      `powershell -NoProfile -Command "$v = (Get-ItemProperty -Path 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize' -ErrorAction SilentlyContinue).StartupDelayInMSec; if ($v -ne $null) { $v } else { '' }"`
    ).toString().trim();
    assert(psCheck3 === '', '3d. PowerShell confirms StartupDelayInMSec property deleted from registry');

  } finally {
    // Restore initial state if user had something configured originally
    if (initial.delayMs !== null) {
      await startup.setStartupDelay(initial.delayMs, initial.waitForIdle ?? true);
      console.log('Restored original startup delay setting:', initial);
    }
  }

  console.log('\n==================================================');
  console.log('LIVE TEST: Step 8 — Startup Backups & Security Rails');
  console.log('==================================================\n');

  const backupDir = framework.getModuleBackupDir('startup');
  console.log('Startup backup directory:', backupDir);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // 4. Test Backup creation with metadata comment header
  const testBackupId = `test-backup-${Date.now()}`;
  const testBackupPath = path.join(backupDir, `${testBackupId}.reg`);

  try {
    const dummySnippet = registry.buildRegSnippet(
      'HKCU',
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      'DeskKleanTestApp',
      '"C:\\TestApp\\test.exe"',
      'REG_SZ'
    );
    const approvedSnippet = registry.buildRegSnippet(
      'HKCU',
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
      'DeskKleanTestApp',
      [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      'REG_BINARY'
    );

    framework.writeRegBackupFile(testBackupPath, [dummySnippet, approvedSnippet], {
      module: 'startup-optimizer',
      itemName: 'DeskKleanTestApp',
      hive: 'HKCU',
      location: 'HKCU_RUN',
      valueName: 'DeskKleanTestApp',
      timestamp: new Date().toISOString(),
    });

    assert(fs.existsSync(testBackupPath), '4a. Backup file written to disk');

    // Verify it is listed in getStartupBackups()
    const backups = await startup.getStartupBackups();
    const found = backups.find((b) => b.id === testBackupId);
    assert(found !== undefined, '4b. getStartupBackups() includes test backup');
    if (found) {
      assert(found.itemName === 'DeskKleanTestApp', '4c. Backup itemName matches');
      assert(found.hive === 'HKCU', '4d. Backup hive matches HKCU');
      assert(found.valueName === 'DeskKleanTestApp', '4e. Backup valueName matches');
      assert(found.location === 'HKCU_RUN', '4f. Backup location matches');
    }

    // 5. Test Path Traversal Security Guards
    console.log('\n--- Test 5: Security Rails & Path Traversal Guards ---');

    let threw1 = false;
    try {
      await startup.planStartupRestore('../../Windows/System32/config');
    } catch (e) {
      threw1 = true;
    }
    assert(threw1, '5a. Traversal attack with ../ rejected');

    let threw2 = false;
    try {
      await startup.planStartupRestore('C:\\Windows\\System32\\calc.exe');
    } catch (e) {
      threw2 = true;
    }
    assert(threw2, '5b. Absolute path injection rejected');

    let threw3 = false;
    try {
      await startup.planStartupRestore('test\0payload');
    } catch (e) {
      threw3 = true;
    }
    assert(threw3, '5c. Null byte injection rejected');

    // 6. Test Header Validation Guard
    const badBackupPath = path.join(backupDir, 'malformed-test.reg');
    fs.writeFileSync(badBackupPath, 'NOT A VALID REGISTRY HEADER\n[Key]\n"Val"=1');
    let threw4 = false;
    try {
      await startup.planStartupRestore('malformed-test');
    } catch (e) {
      threw4 = true;
      assert(e.message.includes('Windows Registry Editor'), '6a. Rejects file missing standard header');
    }
    assert(threw4, '6b. Malformed .reg rejected before execution');
    try { fs.unlinkSync(badBackupPath); } catch {}

    // 7. Test plan creation for valid backup
    console.log('\n--- Test 7: Operation Plan Creation ---');
    const plan = await startup.planStartupRestore(testBackupId);
    assert(plan !== null && plan !== undefined, '7a. planStartupRestore creates plan');
    assert(plan.module === 'startup-optimizer', '7b. Plan module is startup-optimizer');
    assert(plan.reversibility === 'reversible', '7c. Plan marked reversible');
    assert(plan.actions.length === 1, '7d. Plan has 1 action');
    assert(plan.actions[0].kind === 'registry-value', '7e. Action kind is registry-value');

  } finally {
    // Clean up test file
    try {
      if (fs.existsSync(testBackupPath)) {
        fs.unlinkSync(testBackupPath);
      }
    } catch {}
  }

  console.log('\n========================================');
  console.log(`Live Tests Complete! Passed: ${passedCount}, Failed: ${failedCount}`);
  console.log('========================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('Test execution failed:', e);
  process.exit(1);
});
