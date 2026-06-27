#!/usr/bin/env node
/**
 * list-profiles.js — enumerate the Chrome profiles installed on this machine.
 *
 * Outputs ONE LINE per profile, tab-separated:
 *     <profile-dir>\t<display-name>
 *
 * "profile-dir" is what Chrome calls it on disk ("Default", "Profile 1", ...).
 * "display-name" is what the user sees in the avatar menu (e.g. "Personal",
 * "Work") — pulled from the user_data_dir/Local State JSON file.
 *
 * Default profile is always listed first; the rest are sorted alphabetically.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function userDataDir() {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Google", "Chrome");
  }
  if (process.platform === "linux") {
    return path.join(home, ".config", "google-chrome");
  }
  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "User Data");
  }
  return null;
}

const dir = userDataDir();
if (!dir) {
  console.error(`Unsupported platform: ${process.platform}`);
  process.exit(2);
}

const localStatePath = path.join(dir, "Local State");
if (!fs.existsSync(localStatePath)) {
  console.error(
    `No Chrome "Local State" file found at:\n  ${localStatePath}\n\n` +
      `Launch Chrome at least once on this machine, then re-run.`,
  );
  process.exit(3);
}

let localState;
try {
  localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
} catch (err) {
  console.error(`Failed to parse Local State: ${err.message}`);
  process.exit(4);
}

const cache = (localState.profile && localState.profile.info_cache) || {};
const entries = Object.entries(cache);

if (entries.length === 0) {
  console.error("No profiles found in Local State.");
  process.exit(5);
}

entries.sort((a, b) => {
  if (a[0] === "Default") return -1;
  if (b[0] === "Default") return 1;
  return a[0].localeCompare(b[0]);
});

for (const [profileDir, info] of entries) {
  const name = (info && info.name) || profileDir;
  process.stdout.write(`${profileDir}\t${name}\n`);
}
