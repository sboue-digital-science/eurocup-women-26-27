#!/usr/bin/env node
// Refresh data.json for the EuroCup Women player explorer from fiba.basketball.
//
// Usage:   node refresh-fiba.mjs [path/to/data.json]
// Needs:   Node.js 18 or newer (uses the built-in fetch). No packages to install.
//
// What it does
//   1. Reads FIBA's team list for the event, then each team page (roster + season stats).
//   2. Reads each player's page for date of birth, height and all citizenships.
//   3. Writes data.json in the format the dashboard expects, with today's date as "asof".
//
// What it keeps from the existing data.json (not available from FIBA)
//   - team home cities and coordinates ("city"), matched by team name
//   - full country names ("cn")
// A team that is new to the competition (e.g. EuroLeague Women clubs joining the
// play-offs) is reported at the end; add its city to data.json by hand and it will be kept.
//
// Optional environment variables
//   FIBA_EVENT  event slug, default eurocup-women-26-27
//   FIBA_ONLY   comma-separated team slugs, to test on a few teams
//   FIBA_BASE   site root, default https://www.fiba.basketball

import { readFile, writeFile } from 'node:fs/promises';

const EVENT = process.env.FIBA_EVENT || 'eurocup-women-26-27';
const BASE = process.env.FIBA_BASE || 'https://www.fiba.basketball';
const ONLY = (process.env.FIBA_ONLY || '').split(',').filter(Boolean);
const OUT = process.argv[2] || 'data.json';
const PARALLEL = 4;      // pages fetched at the same time
const PAUSE_MS = 250;    // pause between requests per worker, to be polite to FIBA

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(BASE + path, { headers: { 'user-agent': 'Mozilla/5.0 (EuroCup Women dashboard data refresh)', accept: 'text/html' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (e) {
      if (attempt >= 4) throw new Error(`${path}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

// FIBA pages are Next.js apps: the data sits in self.__next_f.push([1,"..."]) script chunks.
function payload(html) {
  const re = /self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;
  let m, s = '';
  while ((m = re.exec(html))) {
    try { const a = JSON.parse(m[1]); if (typeof a[1] === 'string') s += a[1]; } catch { /* skip */ }
  }
  return s;
}

// Every JSON object in the payload that starts with {"<key>": ...
function objects(s, key) {
  const out = [];
  let idx = 0;
  while ((idx = s.indexOf(`{"${key}":`, idx)) !== -1) {
    let depth = 0, inStr = false, esc = false, j = idx;
    for (; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { if (--depth === 0) break; }
    }
    try { out.push(JSON.parse(s.slice(idx, j + 1))); } catch { /* skip */ }
    idx = j + 1;
  }
  return out;
}

async function pool(items, fn) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (next < items.length) {
      const k = next++;
      out[k] = await fn(items[k]);
      if (++done % 50 === 0) console.log(`  ${done}/${items.length}`);
      await sleep(PAUSE_MS);
    }
  }));
  return out;
}

const POS_CODE = { PG: 'Point Guard', SG: 'Shooting Guard', G: 'Guard', SF: 'Small Forward', PF: 'Power Forward', F: 'Forward', C: 'Center' };
const POS_GROUP = { 'Point Guard': 'G', 'Shooting Guard': 'G', Guard: 'G', 'Small Forward': 'F', 'Power Forward': 'F', Forward: 'F', Center: 'C' };
const r1 = x => Math.round(x * 10) / 10;

async function main() {
  const old = await readFile(OUT, 'utf8').then(JSON.parse).catch(() => ({}));
  const oldCity = new Map((old.teams || []).map((t, i) => [t, old.city?.[i] ?? null]));
  const asof = new Date().toISOString().slice(0, 10);
  const asofDate = new Date(asof + 'T12:00:00Z');

  console.log(`Reading team list for ${EVENT}…`);
  const list = payload(await get(`/en/events/${EVENT}/teams`));
  const teamInfo = new Map();
  for (const o of objects(list, 'teamId')) if (o.slug && o.officialName && o.code) teamInfo.set(o.slug, o);
  if (!teamInfo.size) throw new Error('No teams found: FIBA may have changed its page structure.');
  let slugs = [...teamInfo.keys()];
  if (ONLY.length) slugs = slugs.filter(s => ONLY.includes(s));
  slugs.sort((a, b) => teamInfo.get(a).officialName.localeCompare(teamInfo.get(b).officialName, 'en', { sensitivity: 'base' }));

  console.log(`Reading ${slugs.length} team pages…`);
  const teams = await pool(slugs, async slug => {
    const info = teamInfo.get(slug), s = payload(await get(`/en/events/${EVENT}/teams/${slug}`));
    const roster = new Map();
    for (const o of objects(s, 'personId')) if ('isOnFinalRoster' in o && !o.function) roster.set(o.personId, { ...roster.get(o.personId), ...o });
    const stats = new Map();
    for (const o of objects(s, 'playerId')) if ('totalPoints' in o && o.teamId === info.teamId) stats.set(o.playerId, o);
    const listed = new Map();
    for (const o of objects(s, 'playerId')) if ('positionCode' in o) listed.set(o.playerId, o);
    const country = [...roster.values()].map(r => r.clubCountryFIBACode || r.countryFIBACode).find(Boolean) || null;
    return { slug, name: info.officialName, roster, stats, listed, country };
  });

  const jobs = [];
  for (const t of teams) {
    const ids = new Set([...t.roster.keys(), ...[...t.stats.values()].filter(s => s.totalGamesPlayed > 0).map(s => s.playerId)]);
    for (const id of ids) jobs.push({ t, id });
  }
  console.log(`Reading ${jobs.length} player pages…`);
  // FIBA sometimes answers the first request for a player page with a cut-down page that
  // lacks the profile block (birth date, height, citizenships); asking again gets the full one.
  const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  let missing = 0;
  const pages = await pool(jobs, async ({ t, id }) => {
    const who = t.roster.get(id) || t.stats.get(id) || {};
    const path = `/en/events/${EVENT}/teams/${t.slug}/${id}-${slugify(`${who.firstName || ''} ${who.lastName || ''}`) || 'x'}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const s = payload(await get(path));
        const i = s.indexOf('"birthDate"');
        if (i >= 0) return objects(s.slice(s.lastIndexOf('{"playerId"', i)), 'playerId')[0] || {};
      } catch (e) { if (attempt === 4) console.warn('  ! ' + e.message); }
      await sleep(2000 * attempt);
    }
    missing++;
    return {};
  });
  if (missing) console.log(`  ${missing} player page(s) had no profile data; roster values used for those.`);

  const players = [];
  jobs.forEach(({ t, id }, k) => {
    const r = t.roster.get(id), st = t.stats.get(id), l = t.listed.get(id) || {}, pp = pages[k];
    const gp = st?.totalGamesPlayed || 0;
    if (!r && !gp) return;
    const pos = r?.position || POS_CODE[l.positionCode] || '';
    const dob = pp.birthDate || r?.dateOfBirth || l.dateOfBirth || '';
    const cit = pp.nationalities?.length ? pp.nationalities : [r?.nationality || l.nationality].filter(Boolean);
    const n = k2 => st?.[k2] || 0;
    players.push({
      t: teams.indexOf(t),
      n: `${r?.firstName ?? st?.firstName ?? ''} ${r?.lastName ?? st?.lastName ?? ''}`.trim(),
      gone: !r,
      no: Number(r?.uniformNumber ?? st?.uniformNumber) || null,
      p: POS_GROUP[pos] || 'U',
      pos,
      dob,
      age: dob ? r1((asofDate - new Date(dob + 'T12:00:00Z')) / (365.25 * 864e5)) : null,
      h: pp.heightCm > 0 ? pp.heightCm : (r?.heightInCm || null),
      c: cit,
      gp,
      min: r1(n('totalPlayTimeInSeconds') / 60),
      pts: n('totalPoints'), reb: n('totalRebounds'), ast: n('totalAssists'), stl: n('totalSteals'), blk: n('totalBlocks'),
      to: n('totalTurnovers'), eff: n('totalEfficiency'),
      fgm: n('totalFieldGoalsMade'), fga: n('totalFieldGoalsAttempted'),
      tpm: n('totalThreePointsMade'), tpa: n('totalThreePointsAttempted'),
      ftm: n('totalFreeThrowsMade'), fta: n('totalFreeThrowsAttempted'),
    });
  });

  const data = {
    teams: teams.map(t => t.name),
    asof,
    players,
    tc: teams.map(t => t.country),
    cn: old.cn || {},
    city: teams.map(t => oldCity.get(t.name) ?? null),
  };
  await writeFile(OUT, JSON.stringify(data));

  const played = players.filter(p => p.gp > 0).length;
  console.log(`\nWrote ${OUT}: ${teams.length} teams, ${players.length} players (${played} have played), as of ${asof}.`);
  const noCity = teams.filter((t, i) => !data.city[i]).map(t => t.name);
  if (noCity.length) console.log(`No city yet for: ${noCity.join(', ')}. Add [city, lat, lon] for them in "city" in ${OUT}; they are left off the map until then.`);
  const newCodes = [...new Set(players.flatMap(p => p.c))].filter(c => !data.cn[c]);
  if (newCodes.length) console.log(`New citizenship codes without a country name: ${newCodes.join(', ')}. Add them to "cn" in ${OUT}.`);
}

main().catch(e => { console.error('Refresh failed: ' + e.message); process.exit(1); });
