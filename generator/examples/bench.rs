//! Timing harness: `cargo run --release --example bench -- <n> [seeds] [difficulty]`
use colordoku_generator::{Difficulty, generate};
use std::io::Write;

fn main() {
    let n: usize = std::env::args().nth(1).unwrap().parse().unwrap();
    let seeds: u32 = std::env::args().nth(2).map(|s| s.parse().unwrap()).unwrap_or(3);
    let difficulty = match std::env::args().nth(3).as_deref() {
        Some("easy") => Difficulty::Easy,
        Some("hard") => Difficulty::Hard,
        _ => Difficulty::Medium,
    };
    for seed in 1..=seeds {
        let start = std::time::Instant::now();
        let result = generate(n, seed, difficulty);
        let ms = start.elapsed().as_secs_f64() * 1000.0;
        match result {
            Ok(b) => println!(
                "n={n:>2} seed={seed} {ms:>10.1} ms  {} restart(s)  hardness={}",
                b.attempts, b.hardness
            ),
            Err(e) => println!("n={n:>2} seed={seed} {ms:>10.1} ms  FAILED: {e}"),
        }
        std::io::stdout().flush().unwrap();
    }
}
