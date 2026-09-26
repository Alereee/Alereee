#!/usr/bin/env node
/* eslint-disable no-console -- a CLI script, its output is the report */
// Fails on unmet peer dependencies (issue #407). Yarn only warns about them,
// and nothing in CI used to read the warnings — `@nestjs/throttler` stayed on
// a range without NestJS 12 for a whole major and nobody noticed. This script
// reads `yarn explain peer-requirements`, works out which requester breaks
// each unmet requirement, and exits non-zero unless every one of them is
// listed below with a reason. A listed mismatch that no longer exists fails
// too, so the list cannot rot: drop the entry when upstream catches up.
//
//   yarn peers:check           (CI, the lint job; also part of `yarn check`)
//
// Yarn's packageExtensions cannot widen a peer range a package already
// declares (they only add missing ones), which is why the exceptions live
// here rather than in .yarnrc.yml.
import { spawnSync } from 'node:child_process';
import semver from 'semver';

/**
 * Known mismatches: the requester declares a peer range the workspace's
 * version does not satisfy, and the combination is exercised by CI anyway.
 * `peer` and `requester` are package names; `reason` says why it is fine.
 */
const KNOWN_MISMATCHES = [
  {
    peer: 'better-sqlite3',
    requester: 'typeorm',
    reason:
      'typeorm pins better-sqlite3 to ^12; 13 keeps the same API and runs the SQLite tests and the whole server e2e suite',
  },
  {
    peer: 'eslint',
    requester: 'eslint-plugin-import',
    reason:
      'eslint-plugin-import stops at ESLint 9 in its manifest; the flat config runs it on ESLint 10 in `yarn lint`',
  },
  {
    peer: 'typescript',
    requester: 'openapi-typescript',
    reason:
      'openapi-typescript declares TypeScript ^5; the SDK types are generated on 6 and `generate:check` compares them in CI',
  },
];

// Yarn colours its output on GitHub Actions whatever FORCE_COLOR says; its
// own switch turns that off, and the escape codes are stripped anyway
const ANSI_ESCAPE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const stripAnsi = (text) => text.replace(ANSI_ESCAPE, '');

const explain = (args) => {
  const result = spawnSync('yarn', ['explain', 'peer-requirements', ...args], {
    encoding: 'utf8',
    env: { ...process.env, YARN_ENABLE_COLORS: 'false', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`yarn explain peer-requirements ${args.join(' ')} exited with ${result.status}`);
  }
  return stripAnsi(result.stdout);
};

// `p1a4ed → ✘ server@workspace:apps/server provides @nestjs/common ...`
const listUnmet = () =>
  explain([])
    .split('\n')
    .map((line) => /^(p[0-9a-f]{6}) → ✘ /.exec(line)?.[1])
    .filter(Boolean);

// The detailed explanation of one requirement: the peer, the version the
// workspace provides (or nothing), and every requester with its range —
// `├─ @nestjs/throttler@npm:6.5.0 [af8aa] (via ^7.0.0 || ... || ^11.0.0)`
const parseRequirement = (hash) => {
  const text = explain([hash]);
  const header = /^Package (\S+) is requested to provide (\S+) by its descendants$/m.exec(text);
  if (!header) throw new Error(`cannot parse the explanation of ${hash}:\n${text}`);
  const [, provider, peer] = header;
  const provided = /provides \S+ with version (\S+),/.exec(text)?.[1] ?? null;
  const requesters = [];
  for (const line of text.split('\n')) {
    const match = /[├└]─ (.+?)@(?:npm|patch|workspace|virtual):\S* (?:\[[0-9a-f]+\] )?\(via (.+)\)\s*$/.exec(
      line,
    );
    if (match) requesters.push({ name: match[1], range: match[2] });
  }
  return { hash, provider, peer, provided, requesters };
};

const offends = ({ provided }, { range }) =>
  provided === null || !semver.satisfies(provided, range, { includePrerelease: true });

const problems = [];
const seen = new Set();

for (const hash of listUnmet()) {
  const requirement = parseRequirement(hash);
  const offenders = new Map();
  for (const requester of requirement.requesters) {
    if (offends(requirement, requester)) offenders.set(requester.name, requester.range);
  }
  for (const [name, range] of offenders) {
    const known = KNOWN_MISMATCHES.find((m) => m.peer === requirement.peer && m.requester === name);
    const provided = requirement.provided ?? 'nothing';
    const where = `${requirement.provider} provides ${provided} of ${requirement.peer} to ${name} (wants ${range})`;
    if (known) {
      seen.add(known);
      console.log(`known   ${where}\n        ${known.reason}`);
    } else {
      problems.push(`unmet   ${where} [${hash}]`);
    }
  }
}

for (const known of KNOWN_MISMATCHES) {
  if (!seen.has(known)) {
    problems.push(
      `stale   ${known.requester} no longer conflicts on ${known.peer}: remove its entry from KNOWN_MISMATCHES`,
    );
  }
}

if (problems.length > 0) {
  console.error(`\n${problems.join('\n')}\n`);
  console.error(
    'Unmet peer dependencies. Fix the manifest (declare the peer, or move the dependency to the workspace that uses it),\n' +
      'upgrade the package, or — when CI exercises the combination — add it to KNOWN_MISMATCHES in scripts/check-peer-requirements.mjs with a reason.',
  );
  process.exit(1);
}

console.log('\nEvery peer dependency is met or listed as a known mismatch.');
