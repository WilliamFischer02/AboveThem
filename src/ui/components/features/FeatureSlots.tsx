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
import './shared';

export function FeatureSlots() {
  const m = useMatch(s => s.match);
  if (!m) return null;
  const phase = m.phase.phase;
  if (phase === 'lobby' || phase === 'gameOver') return null;
  const meeting = phase === 'meetingDiscussion' || phase === 'meetingVoting';
  const round = phase === 'round' || phase === 'roundStart';
  const ghost = m.players[m.me]?.status !== 'alive';
  return (
    <div className="feat">
      {round && !ghost && <KillClock />}
      {round && <SecurityCard />}
      {meeting && <MeetingMathCard />}
      {meeting && <KillWindowCard />}
      {meeting && <AdminCheckCard />}
      {(meeting || round) && <LastSeenCard open={meeting} />}
      {(meeting || phase === 'ejection') && <VoteTracker open={phase === 'meetingVoting' || phase === 'ejection'} />}
    </div>
  );
}
