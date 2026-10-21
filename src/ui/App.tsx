import { useMatch } from '../state/store';
import { SetupScreen } from './screens/SetupScreen';
import { MatchScreen } from './screens/MatchScreen';

export function App() {
  const hasMatch = useMatch(s => s.match !== null);
  return hasMatch ? <MatchScreen /> : <SetupScreen />;
}
