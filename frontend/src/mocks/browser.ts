import { setupWorker } from 'msw/browser';
import { handlers, wsHandlers } from './handlers';

export async function startMocks() {
  const worker = setupWorker(...handlers, ...wsHandlers);
  await worker.start({
    onUnhandledRequest: 'bypass',
    quiet: true,
    serviceWorker: { url: '/mockServiceWorker.js' },
  });
  console.info('[mocks] MSW mock backend active (HTTP + WebSocket)');
}
