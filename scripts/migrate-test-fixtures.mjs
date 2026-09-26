#!/usr/bin/env node
/**
 * One-shot mechanical v1→v2 test fixture migration for #219 sweep.
 * Idempotent on already-migrated files where patterns differ.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node scripts/migrate-test-fixtures.mjs <files...>");
  process.exit(1);
}

function migrate(content) {
  let out = content;

  // NormalizedMatcher: urlRegex object → source
  out = out.replace(
    /urlRegex:\s*\{\s*source:\s*("(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|\[[^\]]+\][^,]*),\s*flags:\s*""\s*\}/g,
    'source: { key: "url", operator: "regex", value: $1 }',
  );

  // RogatioRule: urlRegex string → source (preserve following comma/newline)
  out = out.replace(
    /urlRegex:\s*("(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`),/g,
    'source: { key: "url", operator: "regex", value: $1 },',
  );

  // Project version in typed fixtures
  out = out.replace(
    /(const \w+Project(?:: RogatioProject)? = \{\s*\n\s*)version: 1,/g,
    "$1version: 2,",
  );
  out = out.replace(/(projectData = \{\s*\n\s*)version: 1,/g, "$1version: 2,");
  out = out.replace(
    /(const mixedProject = \{\s*\n\s*)version: 1,/g,
    "$1version: 2,",
  );

  // Remove group-level origins
  out = out.replace(/\n\s*origins:\s*\[[^\]]*\],/g, "");

  // Remove rule-level origins: [] or origins with values inside rules
  out = out.replace(/\n\s*origins:\s*\[\],/g, "");

  // permissions adapter block in test app options (simple multiline)
  out = out.replace(
    /\n\s*permissions:\s*\{\s*\n\s*contains:[\s\S]*?\n\s*\},/g,
    "",
  );

  // getGrantedOrigins in native session test options
  out = out.replace(/\n\s*getGrantedOrigins:\s*async[^,]*,[^,]*,?\s*/g, "\n");

  // Stored envelope version
  out = out.replace(
    /(StoredProject|StoredValue|state = \{\s*\n\s*)version: 1,/g,
    "$1version: 2,",
  );

  return out;
}

for (const file of files) {
  const before = readFileSync(file, "utf8");
  const after = migrate(before);
  if (after !== before) {
    writeFileSync(file, after);
    console.log("updated", file);
  }
}
