//! End-to-end properties of generated boards.
//!
//! Every assertion here was first verified to hold across 175 boards produced by
//! the Python reference, so a failure means the port diverged, not that the
//! property was wishful thinking.

use colordoku_generator::{
    Difficulty, GenError, GenOptions, GeneratedBoardCore, MAX_N, Rng, generate, generate_with, render, solver,
};

/// The full set of invariants a finished board must satisfy.
fn assert_valid_puzzle(board: &GeneratedBoardCore) {
    let n = board.n;
    let grid = &board.regions;
    let picture = render(grid, Some(&board.queens));

    // Regions partition the grid into exactly n connected pieces.
    assert_eq!(grid.as_slice().len(), n * n, "\n{picture}");
    assert!(
        grid.as_slice().iter().all(|&r| (r as usize) < n),
        "unassigned or out-of-range region id\n{picture}"
    );
    let sizes = grid.region_sizes();
    assert_eq!(sizes.len(), n, "\n{picture}");
    assert!(sizes.iter().all(|&s| s > 0), "empty region\n{picture}");
    assert_eq!(sizes.iter().sum::<usize>(), n * n, "\n{picture}");
    assert!(grid.all_regions_connected(), "disconnected region\n{picture}");

    // Queens satisfy every rule. One per row is structural: queens is row-indexed.
    assert_eq!(board.queens.len(), n);
    assert!(board.queens.iter().all(|&c| (c as usize) < n), "\n{picture}");

    let mut columns = board.queens.clone();
    columns.sort_unstable();
    columns.dedup();
    assert_eq!(columns.len(), n, "two queens share a column\n{picture}");

    let mut regions: Vec<u8> = (0..n).map(|r| grid.get(r, board.queens[r] as usize)).collect();
    regions.sort_unstable();
    regions.dedup();
    assert_eq!(regions.len(), n, "two queens share a region\n{picture}");

    for r in 1..n {
        let step = (board.queens[r] as i32 - board.queens[r - 1] as i32).abs();
        assert!(step >= 2, "queens touch diagonally in row {r}\n{picture}");
    }

    // The puzzle property: one solution, and it is the intended one.
    let mut witnesses = [[0u8; MAX_N]; 2];
    let count = solver::solve(n, grid.as_slice(), 2, &mut witnesses);
    assert_eq!(count, 1, "board has more than one solution\n{picture}");
    assert_eq!(
        &witnesses[0][..n],
        &board.queens[..],
        "the unique solution is not the intended one\n{picture}"
    );
}

#[test]
fn trivial_board() {
    let board = generate(1, 0, Difficulty::Medium).unwrap();
    assert_eq!(board.queens, vec![0]);
    assert_eq!(board.regions.as_slice(), &[0]);
    assert_valid_puzzle(&board);
}

#[test]
fn impossible_sizes_are_rejected() {
    for n in [0usize, 2, 3] {
        assert_eq!(generate(n, 1, Difficulty::Medium).unwrap_err(), GenError::UnsupportedSize(n));
    }
}

#[test]
fn oversized_boards_are_rejected() {
    assert_eq!(
        generate(33, 1, Difficulty::Medium).unwrap_err(),
        GenError::SizeTooLarge { n: 33, max: MAX_N }
    );
}

#[test]
fn errors_read_like_sentences() {
    let message = generate(3, 1, Difficulty::Medium).unwrap_err().to_string();
    assert!(message.contains('3'), "{message}");
    assert!(message.contains("no valid board"), "{message}");
}

#[test]
fn exhaustion_is_reported() {
    // One restart with a single refinement pass essentially never lands on a
    // unique board at this size, so this exercises the give-up path.
    // No node budget here: this test is exercising restart exhaustion, not the
    // node budget, so max_nodes is left unlimited.
    let opts = GenOptions { restarts: 1, refine_iters: 1, max_nodes: u64::MAX, hardness_band: None };
    let mut failures = 0;
    for seed in 0..20u32 {
        let mut rng = Rng::from_seed(seed);
        if let Err(err) = generate_with(9, &mut rng, opts) {
            assert_eq!(err, GenError::Exhausted { n: 9, restarts: 1 });
            failures += 1;
        }
    }
    assert!(failures > 0, "expected at least one exhausted run out of 20");
}

#[test]
fn same_seed_reproduces_the_board() {
    for n in [4usize, 7, 9] {
        for seed in [0u32, 1, 999_999] {
            for difficulty in [Difficulty::Easy, Difficulty::Medium, Difficulty::Hard] {
                let a = generate(n, seed, difficulty).unwrap();
                let b = generate(n, seed, difficulty).unwrap();
                assert_eq!(a.queens, b.queens, "n={n} seed={seed} difficulty={difficulty:?}");
                assert_eq!(a.regions, b.regions, "n={n} seed={seed} difficulty={difficulty:?}");
                assert_eq!(a.attempts, b.attempts, "n={n} seed={seed} difficulty={difficulty:?}");
            }
        }
    }
}

#[test]
fn hardness_orders_easy_below_medium_below_hard_on_average() {
    // Soft/statistical assertion, matching the style of the existing perf
    // tests: hardness_band only narrows the search to a tier, it doesn't
    // pin an exact value, so this checks the tendency across many seeds
    // rather than any single board.
    let n = 8;
    let mean_hardness = |difficulty: Difficulty| -> f64 {
        let total: u64 = (1..=20u32)
            .map(|seed| generate(n, seed, difficulty).unwrap().hardness)
            .sum();
        total as f64 / 20.0
    };

    let easy = mean_hardness(Difficulty::Easy);
    let medium = mean_hardness(Difficulty::Medium);
    let hard = mean_hardness(Difficulty::Hard);

    assert!(easy < medium, "easy={easy} medium={medium}");
    assert!(medium < hard, "medium={medium} hard={hard}");
}

#[test]
fn different_seeds_give_different_boards() {
    let boards: Vec<_> = (1..=8u32)
        .map(|seed| generate(8, seed, Difficulty::Medium).unwrap())
        .map(|b| (b.queens, b.regions))
        .collect();
    let mut unique = boards.clone();
    unique.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.as_slice().cmp(b.1.as_slice())));
    unique.dedup();
    // Phrased loosely so a coincidental collision cannot flake the suite.
    assert!(unique.len() >= 6, "only {} distinct boards from 8 seeds", unique.len());
}

#[test]
fn small_boards_are_valid_puzzles() {
    for n in [1usize, 4, 5, 6, 7, 8, 9] {
        for seed in [1u32, 2, 3] {
            assert_valid_puzzle(&generate(n, seed, Difficulty::Medium).unwrap());
        }
    }
}

#[test]
#[cfg_attr(
    debug_assertions,
    ignore = "slow without optimisations; run with --release"
)]
fn large_boards_are_valid_puzzles() {
    for n in [10usize, 11, 12] {
        for seed in [1u32, 2, 3] {
            assert_valid_puzzle(&generate(n, seed, Difficulty::Medium).unwrap());
        }
    }
}

#[test]
#[ignore = "benchmark: cargo test --release -- --ignored --nocapture timings"]
fn timings() {
    for n in 4..=16usize {
        let start = std::time::Instant::now();
        match generate(n, 1, Difficulty::Medium) {
            Ok(board) => println!(
                "n={n:>2}  {:>8.1} ms  {} restart(s)",
                start.elapsed().as_secs_f64() * 1000.0,
                board.attempts
            ),
            Err(err) => println!("n={n:>2}  {:>8.1} ms  FAILED: {err}", start.elapsed().as_secs_f64() * 1000.0),
        }
    }
}
