/** Meeting card: discussion / voting countdown + the few things worth saying before the vote closes. */
import { useMatch } from '../../../state/store';
import { meetingTimer, prepChecklist } from '../../../engine/features/meetingPrep';
import { fmt } from '../../../engine/evidence';
import { copyText } from '../../clipboard';
import { useTick } from './shared';

export function MeetingPrepCard() {
  useTick(500);
  const m = useMatch(s => s.match);
  const showToast = useMatch(s => s.showToast);
  if (!m) return null;
  const timer = meetingTimer(m, Date.now());
  const items = prepChecklist(m);
  if (!timer && items.length === 0) return null;
  const hurry = timer && timer.stage !== 'over' && timer.votingLeft <= 15;
  return (
    <div className="feat-card" style={hurry ? { borderColor: 'var(--danger, #C51111)' } : undefined}>
      <div className="feat-row">
        <span className="feat-title">📋 Before the vote</span>
        {timer && (timer.stage === 'discussion'
          ? <span className="feat-sub">talk <b className="feat-big">{fmt(timer.stageLeft)}</b> · vote closes {fmt(timer.votingLeft)}</span>
          : timer.stage === 'voting'
            ? <span className={hurry ? 'feat-bad' : 'feat-sub'}>{hurry ? 'VOTE NOW · ' : 'voting · '}<b className="feat-big">{fmt(timer.votingLeft)}</b></span>
            : <span className="feat-sub">time's up</span>)}
      </div>
      {items.length > 0 && (
        <ul className="feat-list">
          {items.slice(0, hurry ? 2 : 6).map(i => (
            <li key={i.id} className={i.priority === 0 ? 'feat-bad' : undefined} title={i.refs.length ? `refs: ${i.refs.join(', ')}` : undefined}>
              {i.text}
              {i.say && <button className="btn xs ghost" style={{ marginLeft: 4 }} title={`Copy: ${i.say}`} onClick={async () => { if (await copyText(i.say!)) showToast(`Copied: ${i.say}`); }}>say ⧉</button>}
            </li>
          ))}
        </ul>
      )}
      <div className="feat-sub">timer from lobby settings (±2 s)</div>
    </div>
  );
}
