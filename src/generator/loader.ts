// Loads the Rust board generator.
//
// This replaces what wasm-bindgen would generate. The module is compiled with a
// plain C ABI and imports nothing, so instantiating it needs no glue and no
// runtime — see generator/src/abi.rs for the other side of this contract.

import wasmUrl from "./colordoku_generator.wasm?url";

/** Status codes from `generate_board`; must match the constants in abi.rs. */
const OK = 0;
const ERR_UNSUPPORTED_SIZE = 1;
const ERR_TOO_LARGE = 2;
const ERR_EXHAUSTED = 3;

interface GeneratorExports {
  memory: WebAssembly.Memory;
  generate_board(size: number, seed: number): number;
  regions_ptr(): number;
  queen_cols_ptr(): number;
  attempts(): number;
  max_size(): number;
}

export interface GeneratedBoard {
  size: number;
  /** Region id per cell, row-major, length `size * size`. */
  regions: Uint8Array;
  /** Column of the queen in each row, length `size`. */
  queenCols: Uint8Array;
  attempts: number;
}

let exports: GeneratorExports | null = null;

async function instantiate(): Promise<GeneratorExports> {
  try {
    const { instance } = await WebAssembly.instantiateStreaming(fetch(wasmUrl), {});
    return instance.exports as unknown as GeneratorExports;
  } catch {
    // instantiateStreaming rejects if the server sends the wrong MIME type for
    // .wasm. Re-fetch rather than reusing the response, whose body may be spent.
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as GeneratorExports;
  }
}

/** Compile and instantiate the module. Safe to call more than once. */
export async function loadGenerator(): Promise<void> {
  exports ??= await instantiate();
}

function required(): GeneratorExports {
  if (exports === null) {
    throw new Error("board generator used before loadGenerator() resolved");
  }
  return exports;
}

/** Largest board the Rust module supports (a wider limit than the CSS palette). */
export function maxSize(): number {
  return required().max_size();
}

function messageFor(code: number, size: number): string {
  switch (code) {
    case ERR_UNSUPPORTED_SIZE:
      return `no valid board exists at size ${size} (only 1 and 4 or more are possible)`;
    case ERR_TOO_LARGE:
      return `board size ${size} is too large (maximum is ${maxSize()})`;
    case ERR_EXHAUSTED:
      return `gave up generating a ${size}x${size} board with exactly one solution`;
    default:
      return `board generator failed with status ${code}`;
  }
}

/**
 * Generate a board with exactly one solution. The same seed gives the same board.
 *
 * Synchronous and potentially slow — call it from a worker, not the main thread.
 */
export function generateBoard(size: number, seed: number): GeneratedBoard {
  const wasm = required();

  const code = wasm.generate_board(size, seed);
  if (code !== OK) throw new Error(messageFor(code, size));

  // Take a fresh view every time: the backing ArrayBuffer is detached whenever
  // the wasm heap grows, which invalidates any view held across a call.
  const memory = new Uint8Array(wasm.memory.buffer);
  const regionsAt = wasm.regions_ptr();
  const queensAt = wasm.queen_cols_ptr();

  return {
    size,
    // slice() copies. The module stages results in one reusable static buffer,
    // so a view would be clobbered by the next call.
    regions: memory.slice(regionsAt, regionsAt + size * size),
    queenCols: memory.slice(queensAt, queensAt + size),
    attempts: wasm.attempts(),
  };
}
