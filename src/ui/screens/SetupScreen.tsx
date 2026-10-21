import { useEffect, useState } from 'react';
import type { LobbySettings, MapId, PlayerColor, PlayerId, Role } from '../../types/game';
import { useMatch } from '../../state/store';
import { MAPS, MAP_IDS } from '../../data/maps';
import { PALETTE, COLOR_IDS } from '../palette';
import { Crewmate } from '../components/Crewmate';
import { DEFAULT_SETTINGS, loadPresets, savePreset, normalizeCode, type LobbyPreset, type PresetPlayer } from '../../state/presets';
import { persist, type MatchFile } from '../../state/persist';
import { fixture } from '../../engine/__fixtures__/skeld_match_01';
import { CapturePanel, type RosterEntry } from '../components/CapturePanel';
import { AutoStatus } from '../components/AutoStatus';
import { useAuto } from '../App';
import { saveSettings } from '../../state/settings';

export function SetupScreen() {
  const newMatch = useMatch(s => s.newMatch);
  const loadMatch = useMatch(s => s.loadMatch);
  const [code, setCode] = useState('');
  const [settings, setSettings] = useState<LobbySettings>(DEFAULT_SETTINGS);
  const [players, setPlayers] = useState<PresetPlayer[]>([]);
  const [me, setMe] = useState<PlayerId | null>(null);
  const [role, setRole] = useState<Role>('crew');
  const [presets, setPresets] = useState<Record<string, LobbyPreset>>({});
  const [recent, setRecent] = useState<MatchFile[]>([]);
  const [dir, setDir] = useState('');
  const auto = useAuto();

  // Dev only: Ctrl+Alt+D starts the fixture demo lobby (used by the hotkey smoke test).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
        e.preventDefault();
        newMatch({
          settings: fixture.settings, map: 'skeld', me: 'cyan', myRole: 'crew',
          players: Object.values(fixture.players).map(p => ({ ...p, status: 'alive', knownRole: p.isMe ? 'crew' : 'unknown' })),
        });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [newMatch]);

  useEffect(() => {
    loadPresets().then(setPresets).catch(() => {});
    persist.listMatches().then(setRecent).catch(() => {});
    persist.appDir().then(setDir).catch(() => {});
  }, []);

  const toggle = (c: PlayerColor) => {
    setPlayers(ps => ps.some(p => p.color === c) ? ps.filter(p => p.color !== c) : [...ps, { id: c, color: c, name: PALETTE[c as keyof typeof PALETTE].label }]);
  };
  const set = <K extends keyof LobbySettings>(k: K, v: LobbySettings[K]) => setSettings(s => ({ ...s, [k]: v }));
  const applyPreset = (p: LobbyPreset) => { setSettings(p.settings); setPlayers(p.players); setMe(p.me); setCode(p.code); };
  const canStart = players.length >= 3 && me !== null && MAPS[settings.map].rooms.length > 0;

  const start = () => {
    if (!canStart || !me) return;
    newMatch({
      settings, map: settings.map, me, myRole: role, lobbyCode: code ? normalizeCode(code) : undefined,
      players: players.map(p => ({ id: p.id, name: p.name || PALETTE[p.color as keyof typeof PALETTE].label, color: p.color, isMe: p.id === me, status: 'alive', knownRole: p.id === me ? role : 'unknown' })),
    });
  };

  return (
    <div className="shell">
      <header className="topbar"><div className="brand">Above<span>Them</span></div><span className="muted small right">lobby setup</span></header>
      <div className="content">
        <section className="panel hero">
          <div className="row">
            <Crewmate color="cyan" size={56} />
            <div className="col" style={{ gap: 2 }}>
              <h2 style={{ margin: 0 }}>Waiting for a lobby</h2>
              <span className="muted small">Join a lobby in Among Us. Everything fills in from the screen.</span>
            </div>
          </div>
          <AutoStatus />
        </section>
        {auto?.settings && (
          <section className="panel tight">
            <div className="row">
              <label className="field">my in-game name (so the auto-roster knows which crewmate is you)
                <input className="input" value={auto.settings.myName} placeholder="exactly as shown in game"
                  onChange={e => auto.setSettings({ ...auto.settings!, myName: e.target.value })}
                  onBlur={() => auto.settings && saveSettings(auto.settings)} />
              </label>
              <label className="check"><input type="checkbox" checked={auto.settings.autoCapture} onChange={e => { const n = { ...auto.settings!, autoCapture: e.target.checked }; auto.setSettings(n); saveSettings(n); }} /> read the game automatically</label>
            </div>
          </section>
        )}
        <details className="fold panel"><summary>Manual setup</summary>
        <section className="panel" style={{ marginTop: 6 }}>
          <h3>Lobby</h3>
          <div className="row">
            <label className="field">code<input className="input" style={{ width: 90, textTransform: 'uppercase' }} value={code} onChange={e => setCode(e.target.value)} placeholder="ABCDEF" /></label>
            <label className="field">map
              <select className="input" value={settings.map} onChange={e => set('map', e.target.value as MapId)}>
                {MAP_IDS.map(id => <option key={id} value={id} disabled={MAPS[id].rooms.length === 0}>{MAPS[id].name}{MAPS[id].rooms.length === 0 ? ' (no data yet)' : ''}</option>)}
              </select>
            </label>
            <label className="field">impostors<input className="input" type="number" min={1} max={3} style={{ width: 60 }} value={settings.impostorCount} onChange={e => set('impostorCount', +e.target.value)} /></label>
            <label className="field">kill cd (s)<input className="input" type="number" min={10} max={60} style={{ width: 60 }} value={settings.killCooldownSec} onChange={e => set('killCooldownSec', +e.target.value)} /></label>
            <label className="field">task bar
              <select className="input" value={settings.taskBarMode} onChange={e => set('taskBarMode', e.target.value as LobbySettings['taskBarMode'])}>
                <option value="always">always</option><option value="meetings">meetings</option><option value="never">never</option>
              </select>
            </label>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <label className="check"><input type="checkbox" checked={settings.visualTasksOn} onChange={e => set('visualTasksOn', e.target.checked)} /> visual tasks</label>
            <label className="check"><input type="checkbox" checked={settings.confirmEjectsOn} onChange={e => set('confirmEjectsOn', e.target.checked)} /> confirm ejects</label>
            <label className="check"><input type="checkbox" checked={settings.anonymousVotes} onChange={e => set('anonymousVotes', e.target.checked)} /> anonymous votes</label>
            <label className="field">speed<input className="input" type="number" step={0.25} min={0.5} max={3} style={{ width: 60 }} value={settings.playerSpeed} onChange={e => set('playerSpeed', +e.target.value)} /></label>
            <label className="field">common<input className="input" type="number" min={0} max={2} style={{ width: 50 }} value={settings.commonTasks} onChange={e => set('commonTasks', +e.target.value)} /></label>
            <label className="field">long<input className="input" type="number" min={0} max={3} style={{ width: 50 }} value={settings.longTasks} onChange={e => set('longTasks', +e.target.value)} /></label>
            <label className="field">short<input className="input" type="number" min={0} max={5} style={{ width: 50 }} value={settings.shortTasks} onChange={e => set('shortTasks', +e.target.value)} /></label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm" disabled={!code.trim()} onClick={async () => { await savePreset({ code, savedAt: Date.now(), settings, players, me }); setPresets(await loadPresets()); }}>Save preset for {code ? normalizeCode(code) : 'code'}</button>
            {Object.values(presets).sort((a, b) => b.savedAt - a.savedAt).slice(0, 8).map(p => (
              <button key={p.code} className="btn sm ghost" onClick={() => applyPreset(p)}>{p.code} <span className="muted small">({p.players.length}p)</span></button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h3>Players — click the crewmates in the lobby</h3>
          <div className="colors">
            {COLOR_IDS.map(c => {
              const on = players.some(p => p.color === c);
              return (
                <div key={c} className={`color-pick ${on ? 'on' : ''}`} onClick={() => toggle(c)}>
                  <Crewmate color={c} size={40} />
                  <span className="k"><span className="key">{PALETTE[c].key}</span> {PALETTE[c].label}</span>
                </div>
              );
            })}
          </div>
          {players.length > 0 && (
            <div className="players" style={{ marginTop: 8 }}>
              {players.map(p => (
                <div key={p.id} className="player-row">
                  <Crewmate color={p.color} size={30} />
                  <input className="input" value={p.name} onChange={e => setPlayers(ps => ps.map(x => x.id === p.id ? { ...x, name: e.target.value } : x))} />
                  <label className="check"><input type="radio" name="me" checked={me === p.id} onChange={() => setMe(p.id)} /> me</label>
                  <button className="btn xs ghost" onClick={() => toggle(p.color)}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 10 }}>
            <label className="field">my role
              <select className="input" value={role} onChange={e => setRole(e.target.value as Role)}>
                <option value="crew">Crewmate</option><option value="impostor">Impostor</option>
              </select>
            </label>
            <button className="btn primary right" disabled={!canStart} onClick={start}>Start match ({players.length} players)</button>
          </div>
          {import.meta.env.DEV && (
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn sm ghost" onClick={() => newMatch({
                settings: fixture.settings, map: 'skeld', me: 'cyan', myRole: 'crew',
                players: Object.values(fixture.players).map(p => ({ ...p, status: 'alive', knownRole: p.isMe ? 'crew' : 'unknown' })),
              })}>dev: start demo lobby (fixture players)</button>
            </div>
          )}
          {!canStart && <div className="muted small" style={{ marginTop: 4 }}>Need ≥ 3 players and pick which one is you.</div>}
        </section>
        </details>

        <details className="fold panel tight"><summary>Screen reading</summary><CapturePanel knownNames={players.map(p => p.name)} onRoster={(entries: RosterEntry[]) => {
          const used = new Set<string>();
          const next: PresetPlayer[] = [];
          for (const e of entries) {
            let color = (e.color === 'unknown' ? 'gray' : e.color) as PlayerColor;
            if (used.has(color)) { const free = COLOR_IDS.find(c => !used.has(c)); if (!free) continue; color = free; }
            used.add(color);
            next.push({ id: color, color, name: e.name });
          }
          setPlayers(next);
        }} /></details>

        <section className="panel">
          <h3>Recent matches</h3>
          {recent.length === 0 && <div className="muted small">None yet. Logs go to {dir}\matches\</div>}
          <div className="col" style={{ gap: 4 }}>
            {recent.slice(0, 10).map(m => (
              <div key={m.id} className="row">
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{m.id}</span>
                <span className="muted small">{(m.bytes / 1024).toFixed(1)} KB</span>
                <button className="btn xs right" onClick={() => loadMatch(m.id)}>Open / replay</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
