/* Esqueleto: substituído pela casca do app. */
import { createRoot } from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';

createRoot(document.getElementById('root')!).render(
  <MantineProvider defaultColorScheme="dark">
    <h1>Baja Telemetria</h1>
  </MantineProvider>,
);
