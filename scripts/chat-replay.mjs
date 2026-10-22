// Replay real match logs through the chat NLU and print line → assertions.
//
//   node scripts/chat-replay.mjs [logDir] [--only-hits] [--json out.json]
//
// logDir defaults to %APPDATA%\AboveThem\matches. Each NDJSON file is replayed with the app's own
// reducer (src/state/events.ts) so the roster / map / phase are what the app had; then every meeting's
// chat goes through parseMeetingChat (context on). Uses Vite's SSR loader to import the TypeScript
// sources directly (no build step, no extra dependency). Logs are local data: never commit them.
import { createServer } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) ?? path.join(process.env.APPDATA ?? '', 'AboveThem', 'matches');
const onlyHits = args.includes('--only-hits');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const events = await server.ssrLoadModule('/src/state/events.ts');
  const nlu = await server.ssrLoadModule('/src/engine/chatNlu/index.ts');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ndjson')).sort();
  let lines = 0, withAssertion = 0, noiseOnly = 0;
  const byKind = {};
  const dump = [];
  for (const f of files) {
    const log = events.parseLines(fs.readFileSync(path.join(dir, f), 'utf8'));
    const m = events.replay(log);
    if (!m || !m.chat.length) continue;
    const meetings = [...new Set(m.chat.map(l => l.meeting))].sort((a, b) => a - b);
    const name = id => m.players[id] ? `${m.players[id].color}` : id;
    console.log(`\n##### ${f}  map=${m.map.id}  players=${Object.values(m.players).map(p => `${p.name}(${p.color})`).join(', ')}`);
    for (const k of meetings) {
      const as = nlu.parseMeetingChat(m, k);
      for (const l of m.chat.filter(x => x.meeting === k)) {
        lines++;
        const mine = as.filter(a => a.line === l.id);
        const real = mine.filter(a => a.kind !== 'noise');
        if (real.length) withAssertion++; else noiseOnly++;
        for (const a of real) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
        dump.push({ file: f, meeting: k, sender: name(l.sender), text: nlu.lineText(l), assertions: real.map(a => ({ kind: a.kind, about: a.about.map(name), room: a.room, reason: a.reason, c: a.confidence, s: a.strength, via: a.resolvedVia, superseded: !!a.supersededBy })) });
        if (onlyHits && !real.length) continue;
        const out = real.map(a => `${a.kind}${a.about.length ? ':' + a.about.map(name).join('+') : ''}${a.room ? '@' + a.room : ''}${a.reason ? '(' + a.reason + ')' : ''} c${a.confidence}${a.supersededBy ? ' ~' : ''}`).join(' | ');
        console.log(`m${k} ${String(name(l.sender)).padEnd(8)} ${JSON.stringify(nlu.lineText(l)).padEnd(46)} → ${out || '∅'}`);
      }
    }
  }
  console.log(`\nTOTAL lines=${lines} withAssertion=${withAssertion} none=${noiseOnly}`);
  console.log('by kind', JSON.stringify(byKind));
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(dump, null, 1));
} finally {
  await server.close();
}
