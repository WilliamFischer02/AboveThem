import { useMemo } from 'react';
import { fixture } from '../engine/__fixtures__/skeld_match_01';
import { scoreAll } from '../engine/suspicion';
import { buildMeetingScript } from '../engine/meetingScript';

/**
 * Placeholder UI: renders the engine output for the fixture match so Phase 0
 * has something visible. Phase 1 replaces this with Roster/Timeline/Meeting panels.
 */
export function App() {
  const scores = useMemo(() => scoreAll(fixture), []);
  const script = useMemo(() => buildMeetingScript(fixture, scores, 0), [scores]);
  return (
    <main className="shell">
      <header className="bar"><strong>AboveThem</strong> <span className="muted">scaffold · fixture match</span></header>
      <section>
        <h2>{script.headline}</h2>
        <h3>Say</h3>
        <ul>{script.say.map((s, i) => <li key={i}>{s.text}</li>)}</ul>
        <h3>Ask</h3>
        <ul>{script.ask.map((q, i) => <li key={i}><b>{q.to}</b>: {q.text}</li>)}</ul>
        <h3>Vote</h3>
        <p><b>{script.vote.target}</b> ({Math.round(script.vote.confidence * 100)}%) — {script.vote.reason}</p>
        <h3>Suspects</h3>
        <table>
          <thead><tr><th>Player</th><th>Verdict</th><th>P</th><th>Evidence</th></tr></thead>
          <tbody>
            {scores.map(s => (
              <tr key={s.player}>
                <td><span className={`swatch ${s.player}`} />{fixture.players[s.player].name}</td>
                <td>{s.verdict}</td>
                <td>{Math.round(s.probability * 100)}%</td>
                <td>{s.evidence.map(e => e.label).join(' · ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
