//! The JavaScript boundary. This is the only module that knows about
//! `wasm-bindgen`; everything it calls is plain Rust.
//!
//! Cells cross the boundary as flat `Uint8Array`s rather than objects: the
//! TypeScript side has to build real `Cell`s (which own DOM nodes and event
//! handlers) regardless, so shipping structured data would only add a serialization
//! dependency and a copy for no benefit.

use crate::generate::Difficulty;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct GeneratedBoard {
    n: u32,
    regions: Vec<u8>,
    queen_cols: Vec<u8>,
    attempts: u32,
}

/// Parses the JS-side `Difficulty` string ("easy"/"medium"/"hard" — see
/// `src/options/options.ts`) into the Rust enum. Any other value falls back to
/// Medium rather than throwing: `generateBoard` already has enough failure
/// modes (bad size, exhausted restarts) that a typo'd difficulty string
/// shouldn't be one more of them, and Medium is the same behavior the crate
/// had before difficulty existed at all.
fn parse_difficulty(difficulty: &str) -> Difficulty {
    match difficulty {
        "easy" => Difficulty::Easy,
        "hard" => Difficulty::Hard,
        _ => Difficulty::Medium,
    }
}

#[wasm_bindgen]
impl GeneratedBoard {
    #[wasm_bindgen(getter)]
    pub fn size(&self) -> u32 {
        self.n
    }

    /// Region id per cell, row-major, length `size * size`.
    ///
    /// Each access copies out of linear memory, so read it once.
    #[wasm_bindgen(getter)]
    pub fn regions(&self) -> Vec<u8> {
        self.regions.clone()
    }

    /// Column of the queen in each row, length `size`.
    #[wasm_bindgen(getter, js_name = queenCols)]
    pub fn queen_cols(&self) -> Vec<u8> {
        self.queen_cols.clone()
    }

    /// How many restarts generation needed. Diagnostics only.
    #[wasm_bindgen(getter)]
    pub fn attempts(&self) -> u32 {
        self.attempts
    }
}

/// Generate a board with exactly one solution.
///
/// The same `(seed, difficulty)` always produces the same board — see
/// `parse_difficulty` for the accepted `difficulty` strings. Throws a
/// JavaScript `Error` when the size has no valid board, exceeds the supported
/// maximum, or generation runs out of restarts.
#[wasm_bindgen(js_name = generateBoard)]
pub fn generate_board(size: u32, seed: u32, difficulty: &str) -> Result<GeneratedBoard, JsError> {
    let board = crate::generate(size as usize, seed, parse_difficulty(difficulty))?;
    Ok(GeneratedBoard {
        n: board.n as u32,
        regions: board.regions.into_vec(),
        queen_cols: board.queens,
        attempts: board.attempts,
    })
}
