/**
 * The receiving end of "Report a misread" (src/dev/capture.ts): a Vite plugin that adds
 * one route to the local dev or preview server and writes each posted page to a file.
 *
 * It exists so that handwriting written on a tablet lands on the development machine,
 * where it can be replayed. It is only ever attached to a server started on that
 * machine; a deployed build is static files and has no server to attach it to.
 */

import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Connect, Plugin } from 'vite';

const ROUTE = '/__capture';
/** Generous: a full page of dense handwriting is a few hundred kilobytes. */
const MAX_BYTES = 4 * 1024 * 1024;

export function captureInk(directory = 'captures'): Plugin {
  const folder = resolve(directory);
  let count = 0;

  const save = async (text: string): Promise<string> => {
    const page = JSON.parse(text) as { format?: unknown; note?: unknown; strokes?: unknown };
    if (page.format !== 'calcink-page' || !Array.isArray(page.strokes)) {
      throw new Error('not a page snapshot');
    }
    // The name comes from the clock and a counter, never from the request.
    const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${++count}.json`;
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, name), `${text}\n`, 'utf8');
    console.log(
      `[capture] ${directory}/${name}: ${page.strokes.length} strokes, meant "${String(page.note)}"`,
    );
    return name;
  };

  const handle: Connect.NextHandleFunction = (request, response, next) => {
    if (request.method !== 'POST') return next();

    const reply = (status: number, body: object): void => {
      response.statusCode = status;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(body));
    };

    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BYTES) chunks.push(chunk);
    });
    request.on('end', () => {
      if (size > MAX_BYTES) return reply(413, { error: 'too large' });
      save(Buffer.concat(chunks).toString('utf8')).then(
        (name) => reply(200, { saved: name }),
        (error: unknown) => reply(400, { error: error instanceof Error ? error.message : 'bad' }),
      );
    });
  };

  return {
    name: 'calcink:capture-ink',
    configureServer(server) {
      server.middlewares.use(ROUTE, handle);
    },
    configurePreviewServer(server) {
      server.middlewares.use(ROUTE, handle);
    },
  };
}
