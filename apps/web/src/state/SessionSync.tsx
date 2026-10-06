/* Ligações entre a biblioteca (contexto React), os perfis e a sessão aberta:
 *  - LibrarySync: registra a biblioteca ativa para openFromLibrary e carrega os perfis de
 *    carro/pista dela (de novo quando a biblioteca muda ou alguém chama bump()).
 *  - SessionSensorProvider: alimenta os chips dos sensores com sensorAvailability(ctx) da
 *    sessão aberta (verde/cinza/tracejado). Sem sessão: chips neutros (só o catálogo). */
import { useEffect, type ReactNode } from 'react';
import { useLibrary } from '../library/context';
import { SensorAvailabilityProvider } from '../components/SensorChips';
import { setSessionLibrary, useSessionStore } from './session';
import { useProfiles } from './profiles';

export function LibrarySync() {
  const { lib, version } = useLibrary();
  useEffect(() => {
    setSessionLibrary(lib);
    void useProfiles.getState().load(lib);
  }, [lib, version]);
  return null;
}

export function SessionSensorProvider({ children }: { children: ReactNode }) {
  const availability = useSessionStore(s => s.availability);
  return <SensorAvailabilityProvider value={availability}>{children}</SensorAvailabilityProvider>;
}
