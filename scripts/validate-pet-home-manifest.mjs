/**
 * Validates 场景/generated/pet-home-assets/manifest.json for CI / pre-release.
 * Ensures JSON parses and contains at least one row pointing at pet-home badge PNGs.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const MANIFEST_REL = path.join('场景', 'generated', 'pet-home-assets', 'manifest.json');
const MANIFEST_ABS = path.join(projectRoot, MANIFEST_REL);

async function main() {
  let raw;
  try {
    raw = await readFile(MANIFEST_ABS, 'utf8');
  } catch (e) {
    console.error(`validate-pet-home-manifest: cannot read ${MANIFEST_REL}:`, e.message);
    process.exit(1);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error('validate-pet-home-manifest: invalid JSON:', e.message);
    process.exit(1);
  }

  const rows = Array.isArray(data) ? data : data && Array.isArray(data.items) ? data.items : null;
  if (!rows) {
    console.error('validate-pet-home-manifest: root must be a JSON array or { items: [] }');
    process.exit(1);
  }

  const prefix = '场景/generated/pet-home-assets/badges/';
  const badgeRows = rows.filter(
    (r) => r && typeof r.output === 'string' && r.output.includes(prefix) && r.output.endsWith('.png')
  );

  if (badgeRows.length === 0) {
    console.error(
      `validate-pet-home-manifest: no rows with output under "${prefix}" — static domestic pools will be empty.`
    );
    process.exit(1);
  }

  const re = /场景\/generated\/pet-home-assets\/badges\/([^/]+)\//;
  const poolKeys = new Set();
  let shapeMismatch = 0;
  for (const r of badgeRows) {
    const m = r.output.match(re);
    if (m) poolKeys.add(m[1]);
    else shapeMismatch += 1;
  }

  console.log(
    `validate-pet-home-manifest: ok — ${badgeRows.length} badge row(s), ${poolKeys.size} distinct pool key(s).`
  );
  if (shapeMismatch > 0) {
    console.warn(
      `validate-pet-home-manifest: ${shapeMismatch} row(s) did not match expected badges/<city>/ path pattern.`
    );
  }
}

main();
