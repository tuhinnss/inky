/**
 * "Report a misread": a development aid for collecting real handwriting.
 *
 * It adds one button to the page. Pressing it asks what the page was meant to say and
 * sends the ink, the readings and that answer to the server the page came from, which
 * writes them to a file (see scripts/dev/captureInk.ts). Where there is no such server
 * the file is downloaded instead.
 *
 * This module is loaded only by the dev server and by a `--mode capture` build. The
 * production build does not contain it, and the app itself never sends anything anywhere.
 */

import type { App } from '../app/App';
import './capture.css';
import { takeSnapshot } from './snapshot';

const ENDPOINT = './__capture';

/** Adds the button. Returns a function that removes it again. */
export function installCapture(app: App): () => void {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'capture-button';
  button.textContent = 'Report a misread';
  button.title = 'Save this page so the handwriting can be studied';

  const onClick = (): void => void report(app);
  button.addEventListener('click', onClick);
  document.body.append(button);

  return () => {
    button.removeEventListener('click', onClick);
    button.remove();
  };
}

async function report(app: App): Promise<void> {
  const strokes = app.store.all();
  if (strokes.length === 0) {
    app.showNotice('There is nothing on the page to save yet.', 3000);
    return;
  }

  // Start from what was read, so that only the mistakes need correcting.
  const read = app.equations.map((equation) => equation.expression).join(', ');
  const note = window.prompt(
    'What did you write? Correct anything that was read wrongly.\n' +
      'One sum after another, separated by commas. * and / are fine for × and ÷.',
    read,
  );
  if (note === null) return; // cancelled

  const capturedAt = new Date().toISOString();
  const body = JSON.stringify(
    takeSnapshot(strokes, app.equations, {
      note,
      capturedAt,
      device: {
        userAgent: navigator.userAgent,
        width: window.innerWidth,
        height: window.innerHeight,
        pixelRatio: window.devicePixelRatio,
      },
    }),
  );

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    app.showNotice(`Saved ${strokes.length} strokes for study. Thank you.`, 4000);
  } catch {
    download(body, `calcink-page-${capturedAt.replace(/[:.]/g, '-')}.json`);
    app.showNotice('No capture server here, so the page was downloaded as a file.', 6000);
  }
}

function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
