/**
 * The single mount point for every feature card (features agent). MatchScreen renders
 * `<FeatureSlots />` once; this component decides what to show for the current phase.
 * Every card is self-contained (reads the store itself) and fails soft (renders nothing
 * when it has nothing to say).
 */
import { useMatch } from '../../../state/store';
import { KillClock } from './KillClock';
import { KillWindowCard } from './KillWindowCard';
import './shared';

export function FeatureSlots() {
  const m = useMatch(s => s.match);
  if (!m) return null;
  const phase = m.phase.phase;
  const meeting = phase === 'meetingDiscussion' || phase === 'meetingVoting';
  const ghost = m.players[m.me]?.status !== 'alive';
  if (phase === 'lobby' || phase === 'gameOver') return null;
  return (
    <div className="feat">
      {(phase === 'round' || phase === 'roundStart') && !ghost && <KillClock />}
      {meeting && <KillWindowCard />}
    </div>
  );
}
