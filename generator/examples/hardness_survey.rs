//! One-off measurement harness for GenOptions::for_size's Easy/Hard hardness
//! bands (docs/plans/board-generation-difficulty.md, Phase 2). Not part of the
//! shipped crate's public surface — kept as an example so the methodology is
//! reproducible, same spirit as `bench.rs`.
//!
//! Samples N unconstrained (Medium) boards per size and prints the hardness
//! distribution's percentiles.
use colordoku_generator::{generate, Difficulty};

fn main() {
    let samples: u32 = std::env::args().nth(1).map(|s| s.parse().unwrap()).unwrap_or(200);
    for n in 4..=12usize {
        let mut hardness: Vec<u64> = (1..=samples)
            .filter_map(|seed| generate(n, seed, Difficulty::Medium).ok())
            .map(|b| b.hardness)
            .collect();
        hardness.sort_unstable();
        let pct = |p: f64| -> u64 {
            let idx = ((hardness.len() as f64 - 1.0) * p).round() as usize;
            hardness[idx]
        };
        println!(
            "n={n:>2} samples={:>4} p10={:>6} p25={:>6} p50={:>6} p75={:>6} p90={:>6} max={:>6}",
            hardness.len(),
            pct(0.10),
            pct(0.25),
            pct(0.50),
            pct(0.75),
            pct(0.90),
            hardness.last().copied().unwrap_or(0),
        );
    }
}
