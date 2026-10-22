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
import { CopyButton } from './MeetingPanel';

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
      <div className="imp-head">
        <span className="imp-title">🔪 IMPOSTOR</span>
        {partner && <span className="imp-partner" title="Your partner"><PlayerIcon id={partner.id} color={partner.color} size={22} /><b>{partner.name}</b></span>}
        <span className="imp-mode right" title={inMeeting ? 'Say less, push one name' : 'Build your story as you move'}>{inMeeting ? '🗣 push one name' : '🧭 build your story'}</span>
      </div>

      {adv.partnerWarning && (
        <div className="imp-warn">
          <b>Room is turning on {partner?.name}.</b> Don't hard-defend — mild doubt, then an alternative:
          {adv.partnerWarning.map((l, i) => <div key={i} className="small">· {l}</div>)}
        </div>
      )}

      {inMeeting && adv.push && (
        <div className="vote-card go imp-push">
          <PlayerIcon id={adv.push.target} color={match.players[adv.push.target]?.color ?? 'unknown'} size={36} />
          <div className="col grow" style={{ gap: 2, minWidth: 0 }}>
            <div className="imp-push-t">PUSH {name(adv.push.target)}</div>
            <div className="small">“{adv.push.line}”</div>
            <div className="small muted">{adv.push.why}</div>
          </div>
          <CopyButton text={adv.push.line} />
        </div>
      )}

      {adv.alibis.length > 0 && <div className="menu-sec">Your story</div>}
      {adv.alibis.slice(0, 1).map((a, i) => <ImpLine key={i} text={a.text} note={`weak point: ${a.weakPoint}`} />)}
      {adv.alibis.length > 1 && (
        <details className="fold"><summary>{adv.alibis.length - 1} more alibi{adv.alibis.length > 2 ? 's' : ''}</summary>
          {adv.alibis.slice(1).map((a, i) => <ImpLine key={i} text={a.text} note={`weak point: ${a.weakPoint}`} />)}
        </details>
      )}

      {adv.defenses.length > 0 && <div className="menu-sec">{adv.defenses[0]?.accuser ? `Answering ${adv.defenses[0].accuser}` : 'If accused'}</div>}
      {adv.defenses.slice(0, 1).map((d, i) => <Defense key={i} d={d} />)}
      {adv.defenses.length > 1 && (
        <details className="fold"><summary>{adv.defenses.length - 1} more answer{adv.defenses.length > 2 ? 's' : ''}</summary>
          {adv.defenses.slice(1).map((d, i) => <Defense key={i} d={d} />)}
        </details>
      )}

      <details className="fold"><summary>Rules you'll forget under pressure</summary>
        <ul className="small" style={{ margin: '4px 0 0 16px' }}>{adv.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
      </details>
    </section>
  );
}

/** One sentence you could paste into chat + copy button + a small note under it. */
function ImpLine({ text, note }: { text: string; note?: string }) {
  return (
    <div className="script-line">
      <div className="col">
        <span className="text">{text}</span>
        {note && <span className="small muted">{note}</span>}
      </div>
      <CopyButton text={text} />
    </div>
  );
}

type Def = ReturnType<typeof impostorAdvice>['defenses'][number];
function Defense({ d }: { d: Def }) {
  return (
    <div className="imp-def">
      <div className="small muted">{TYPE_LABEL[d.type] ?? d.type}{d.accuser ? ` — by ${d.accuser}` : ''}</div>
      {d.lines.slice(0, 2).map((l, j) => <ImpLine key={j} text={l} />)}
      <div className="small" style={{ color: '#ffb3b3' }}>avoid: {d.avoid.join(' / ')}</div>
      <div className="small muted">then: {d.followup}</div>
    </div>
  );
}