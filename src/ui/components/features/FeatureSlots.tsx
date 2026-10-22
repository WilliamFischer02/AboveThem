/**
 * The single mount point for every feature card (features agent). MatchScreen renders
 * `<FeatureSlots />` once; this component decides what to show for the current phase.
 * Every card is self-contained (reads the store itself) and fails soft (renders nothing
 * when it has nothing to say).
 */
import { useMatch } from '../../../state/store';
import { KillClock } from './KillClock';
import { KillWindowCard } from './KillWindowCard';
import { MeetingMathCard } from './MeetingMathCard';
import { LastSeenCard } from './LastSeenCard';
import { SecurityCard } from './SecurityCard';
import { AdminCheckCard } from './AdminCheckCard';
import { VoteTracker } from './VoteTracker';
import { TaskBarCard } from './TaskBarCard';
import { TaskClaimsCard } from './TaskClaimsCard';
import { MeetingPrepCard } from './MeetingPrepCard';
import { RoundPlanCard } from './RoundPlanCard';
import './shared';

/** compact (ui-streamline, thin window): the kill clock stays visible, every other card folds into one line so the roster is not pushed below the fold. */
export function FeatureSlots({ compact = false }: { compact?: boolean } = {}) {
  const m = useMatch(s => s.match);
  if (!m) return null;
  const phase = m.phase.phase;
  if (phase === 'lobby' || phase === 'gameOver') return null;
  const meeting = phase === 'meetingDiscussion' || phase === 'meetingVoting';
  const round = phase === 'round' || phase === 'roundStart';
  const ghost = m.players[m.me]?.status !== 'alive';
  const clock = round && !ghost ? <KillClock /> : null;
  const cards = (
    <>
      {round && !ghost && <RoundPlanCard />}
      {round && !ghost && <TaskBarCard />}
      {round && <SecurityCard />}
      {meeting && !ghost && <MeetingPrepCard />}
      {meeting && <MeetingMathCard />}
      {meeting && <KillWindowCard />}
      {meeting && <AdminCheckCard />}
      {meeting && <TaskClaimsCard />}
      {(meeting || round) && <LastSeenCard />}
      {(meeting || phase === 'ejection') && <VoteTracker open={phase === 'meetingVoting' || phase === 'ejection'} />}
    </>
  );
  if (compact) {
    return (
      <div className="feat">
        {clock}
        <details className="feat-card feat-fold">
          <summary><span className="feat-title">🧰 {meeting ? 'Meeting tools' : 'Round tools'}</span><span className="feat-sub">{meeting ? 'count · kill window · last seen · votes' : 'plan · task bar · security · last seen'}</span></summary>
          <div className="feat">{cards}</div>
        </details>
      </div>
    );
  }
  return (
    <div className="feat">
      {clock}
      {cards}
    </div>
  );
}
