import { createContext, useContext } from 'react';
import { useMatch } from '../state/store';
import { SetupScreen } from './screens/SetupScreen';
import { MatchScreen } from './screens/MatchScreen';
import { useGameEvents } from '../input/useGameEvents';

export type Auto = ReturnType<typeof useGameEvents>;
export const AutoContext = createContext<Auto | null>(null);
export const useAuto = () => useContext(AutoContext);

export function App() {
  const hasMatch = useMatch(s => s.match !== null);
  const auto = useGameEvents();
  return (
    <AutoContext.Provider value={auto}>
      {hasMatch ? <MatchScreen /> : <SetupScreen />}
    </AutoContext.Provider>
  );
}
