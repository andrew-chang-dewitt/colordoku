// Runs board generation off the main thread.
//
// Generation is a single synchronous Rust call that can take tens of seconds at
// the largest sizes, so running it on the main thread freezes the tab outright.
// Here it only blocks this worker, leaving the page responsive and cancellable.

import init, { generateBoard } from "../generator/pkg/colordoku_generator.js";

export interface GenerateRequest {
  id: number;
  size: number;
  seed: number;
}

export type GenerateResponse =
  | {
      id: number;
      ok: true;
      size: number;
      regions: Uint8Array;
      queenCols: Uint8Array;
      attempts: number;
    }
  | { id: number; ok: false; name: string; message: string };

// The worker global has no DOM-lib type, and pulling in the webworker lib clashes
// with it. Narrowing to the two members used here keeps this file typed without
// touching the project's lib settings.
const ctx = self as unknown as {
  postMessage(message: GenerateResponse, transfer?: Transferable[]): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<GenerateRequest>) => void,
  ): void;
};

let ready: Promise<unknown> | null = null;
function ensureReady(): Promise<unknown> {
  if (ready === null) {
    ready = init().catch((err: unknown) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

ctx.addEventListener("message", (event) => {
  const { id, size, seed } = event.data;

  void ensureReady().then(
    () => {
      let board;
      try {
        board = generateBoard(size, seed);
      } catch (err) {
        ctx.postMessage({
          id,
          ok: false,
          name: err instanceof Error ? err.name : "Error",
          message: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      try {
        // These getters each copy out of wasm memory, so the buffers are ours to
        // hand over rather than clone.
        const regions = board.regions;
        const queenCols = board.queenCols;
        ctx.postMessage(
          { id, ok: true, size: board.size, regions, queenCols, attempts: board.attempts },
          [regions.buffer, queenCols.buffer],
        );
      } finally {
        board.free();
      }
    },
    (err: unknown) => {
      ctx.postMessage({
        id,
        ok: false,
        name: "Error",
        message: `could not load the board generator: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    },
  );
});
