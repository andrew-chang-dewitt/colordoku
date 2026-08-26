//! The wasm boundary, written by hand.
//!
//! Deliberately not wasm-bindgen: that would make building the project depend on
//! a code generator whose CLI version must match the crate version exactly, which
//! in practice means depending on `wasm-pack` to fetch it. With a plain C ABI the
//! whole build is `cargo build --target wasm32-unknown-unknown --release` and the
//! crate needs no dependencies at all. The resulting module imports nothing, so
//! the JavaScript side is a `WebAssembly.instantiate` call and a few reads out of
//! linear memory (see `src/generator/loader.ts`).
//!
//! Results are staged in a fixed static buffer rather than allocated per call, so
//! nothing has to be freed across the boundary. That makes this **single-use at a
//! time**: each call overwrites the previous result, and the caller must copy what
//! it needs before calling again. The app drives this from a dedicated worker that
//! keeps one generation in flight, and `MAX_N` bounds the buffer at ~1 KB.

use crate::{GenError, MAX_N};

const REGION_BYTES: usize = MAX_N * MAX_N;
const QUEEN_BYTES: usize = MAX_N;

/// Region ids first, then queen columns.
static mut OUT: [u8; REGION_BYTES + QUEEN_BYTES] = [0; REGION_BYTES + QUEEN_BYTES];
static mut ATTEMPTS: u32 = 0;

/// Status codes returned by [`generate_board`]. The loader turns these back into
/// readable messages; keeping strings out of the ABI avoids marshalling them.
pub const OK: u32 = 0;
pub const ERR_UNSUPPORTED_SIZE: u32 = 1;
pub const ERR_TOO_LARGE: u32 = 2;
pub const ERR_EXHAUSTED: u32 = 3;

/// Generate a board into the staging buffer. Returns one of the status codes.
///
/// On success, read `size * size` bytes from [`regions_ptr`] and `size` bytes
/// from [`queen_cols_ptr`], and copy them out before calling again.
#[unsafe(no_mangle)]
pub extern "C" fn generate_board(size: u32, seed: u32) -> u32 {
    let board = match crate::generate(size as usize, seed) {
        Ok(board) => board,
        Err(GenError::UnsupportedSize(_)) => return ERR_UNSUPPORTED_SIZE,
        Err(GenError::SizeTooLarge { .. }) => return ERR_TOO_LARGE,
        Err(GenError::Exhausted { .. }) => return ERR_EXHAUSTED,
    };

    let n = board.n;
    let base = &raw mut OUT as *mut u8;
    // SAFETY: n <= MAX_N is guaranteed by `generate`, so both copies stay inside
    // OUT, and the source slices are exactly n*n and n bytes long. Nothing else
    // holds a reference to OUT: the pointer accessors below hand out raw pointers
    // and the module is single-threaded.
    unsafe {
        core::ptr::copy_nonoverlapping(board.regions.as_slice().as_ptr(), base, n * n);
        core::ptr::copy_nonoverlapping(board.queens.as_ptr(), base.add(REGION_BYTES), n);
        ATTEMPTS = board.attempts;
    }

    OK
}

/// Start of the region ids, valid for `size * size` bytes after a successful call.
#[unsafe(no_mangle)]
pub extern "C" fn regions_ptr() -> *const u8 {
    &raw const OUT as *const u8
}

/// Start of the queen columns, valid for `size` bytes after a successful call.
#[unsafe(no_mangle)]
pub extern "C" fn queen_cols_ptr() -> *const u8 {
    // SAFETY: REGION_BYTES is an offset within OUT.
    unsafe { (&raw const OUT as *const u8).add(REGION_BYTES) }
}

/// Restarts the last successful generation needed. Diagnostics only.
#[unsafe(no_mangle)]
pub extern "C" fn attempts() -> u32 {
    // SAFETY: single-threaded, plain copy out of a static.
    unsafe { ATTEMPTS }
}

/// Largest board this module can generate, so the loader need not hardcode it.
#[unsafe(no_mangle)]
pub extern "C" fn max_size() -> u32 {
    MAX_N as u32
}
