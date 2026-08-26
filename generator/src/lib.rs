//! Board generator for colordoku, a "Queens" puzzle.
//!
//! A board is an `n x n` grid partitioned into `n` orthogonally connected regions.
//! Its solution places `n` queens with exactly one in every row, every column, and
//! every region, and no two adjacent — orthogonally or diagonally. A generated
//! board is guaranteed to have exactly one such solution.
//!
//! Valid boards exist for `n == 1` and `n >= 4`; 2 and 3 are impossible.
//!
//! Ported from `src/board/generator.py`. The port uses xoshiro256** where the
//! reference used Python's Mersenne Twister, so **the two do not produce the same
//! boards for the same seed** — that is expected, not a bug. Determinism holds
//! within this crate: the same seed gives the same board on every target,
//! including wasm32.

pub mod error;
pub mod generate;
pub mod grid;
pub mod render;
pub mod rng;
pub mod solver;

#[cfg(target_arch = "wasm32")]
mod wasm;

/// Largest board this crate can generate.
///
/// Set by the solver's `u32` column and region bitmasks, and by the `[u32; MAX_N]`
/// row masks in the connectivity check. Widening both to `u64` would raise it to 64
/// at a real cost to the hottest loop in the program, and nothing wants boards that
/// large — the app caps at 16 anyway, because that is how many colours the
/// stylesheet defines.
pub const MAX_N: usize = 32;

pub use error::GenError;
pub use generate::{GenOptions, GeneratedBoardCore, generate, generate_with};
pub use grid::RegionGrid;
pub use render::render;
pub use rng::Rng;
