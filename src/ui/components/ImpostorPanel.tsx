/**
 * Impostor mode: what to say, who to push, how to answer. Replaces the crew
 * meeting script while my role is impostor. Everything shown is built from
 * what was actually logged this round (ledger rules in docs/IMPOSTOR_PLAYBOOK.md).
 */
import { useMemo } from 'react';
import type { SuspectScore } from '../../types/game';
import { useMatch } from '../../state/store';
import { impostorAdvice } from '../../engine/impostor';
import { PlayerIcon } from './Crewmate';

const TYPE_LABEL: Record<string, string> = {
  where_were_you: 'Where were you?', near_the_body: 'You were near the body', you_were_alone: 'You were alone',
  saw_you_leave_kill_room: 'Seen leaving the kill room / venting', faked_task: 'You faked a task', didnt_vote_with_us: "You didn't vote with us",
  partner_being_voted: 'Partner being voted', fifty_fifty: '50/50', you_reported: 'You reported it',
};

export function ImpostorPanel({ scores, inMeeting }: { scores: SuspectScore[]; inMeeting: boolean }) {
  const match = useMatch(s => s.match)!;
  const meeting = match.phase.meeting ?? 0;
  const adv = useMemo(() => impostorAdvice(match, scores, meeting), [match, scores, meeting]);
  const name = (id: string) => match.players[id]?.name ?? id;
  const partner = Object.values(match.players).find(p => p.isPartner);

  return (
    <section className="panel impostor-panel">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3 style={{ color: '#ff5c5c' }}>IMPOSTOR</h3>
        {partner && <span className="row" style={{ gap: 6 }}><PlayerIcon id={partner.id} color={partner.color} size={28} /><span className="badge imp">partner: {partner.name}</span></span>}
        <span className="muted small right">{inMeeting ? 'meeting: say less, push one name' : 'round: build your story as you move'}</span>
      </div>

      {adv.partnerWarning && (
        <div className="script-line" style={{ borderColor: '#ffd166', marginBottom: 6 }}>
          <span className="text"><b>Room is turning on {partner?.name}.</b> Don't hard-defend — mild doubt, then an alternative:</span>
          {adv.partnerWarning.map((l, i) => <span key={i} className="small">· {l}</span>)}
        </div>
      )}

      {inMeeting && adv.push && (
        <div className="vote-card big go" style={{ marginBottom: 8 }}>
          <PlayerIcon id={adv.push.target} color={match.players[adv.push.target]?.color ?? 'unknown'} size={48} />
          <div className="col" style={{ gap: 2 }}>
            <div style={{ fontWeight: 800, fontSize: 20 }}>PUSH {name(adv.push.target)}</div>
            <div className="small">“{adv.push.line}”</div>
            <div className="small muted">{adv.push.why}</div>
          </div>
        </div>
      )}

      <h3>Your story (from what you logged)</h3>
      <div className="col" style={{ marginBottom: 8 }}>
        {adv.alibis.map((a, i) => (
          <div key={i} className="script-line">
            <span className="text">{a.text}</span>
            <span className="small muted">weak point: {a.weakPoint}</span>
          </div>
        ))}
      </div>

      <h3>{adv.defenses[0]?.accuser ? `Answering ${adv.defenses[0].accuser}` : 'If accused'}</h3>
      <div className="col" style={{ marginBottom: 8 }}>
        {adv.defenses.map((d, i) => (
          <div key={i} className="script-line">
            <span className="small muted">{TYPE_LABEL[d.type] ?? d.type}{d.accuser ? ` — by ${d.accuser}` : ''}</span>
            {d.lines.slice(0, 2).map((l, j) => <span key={j} className="text">“{l}”</span>)}
            <span className="small" style={{ color: '#ffb3b3' }}>avoid: {d.avoid.join(' / ')}</span>
            <span className="small muted">then: {d.followup}</span>
          </div>
        ))}
      </div>

      <details className="fold"><summary>Rules you'll forget under pressure</summary>
        <ul className="small" style={{ margin: '4px 0 0 16px' }}>{adv.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </details>
    </section>
  );
}
