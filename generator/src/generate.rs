//! The generation pipeline: place queens, grow regions around them, then refine
//! the regions until exactly one solution survives.
//!
//! Ported from `src/board/generator.py`. Two deliberate departures from that
//! source are marked inline below; neither changes the distribution of boards.

use crate::error::GenError;
use crate::grid::{RegionGrid, UNASSIGNED, neighbours};
use crate::rng::Rng;
use crate::solver::{self, Placement};
use crate::MAX_N;

#[derive(Debug, Clone)]
pub struct GeneratedBoardCore {
    pub n: usize,
    /// `queens[r]` is the column of the queen in row `r`.
    pub queens: Vec<u8>,
    pub regions: RegionGrid,
    /// How many restarts it took, for diagnostics.
    pub attempts: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct GenOptions {
    pub restarts: u32,
    pub refine_iters: u32,
    /// Upper bound on total solver nodes (`solver::solve_counted`'s recursive-call
    /// count, summed across every `solve` inside one `refine_unique` call) a
    /// single attempt may spend before it is abandoned as doomed. `u64::MAX`
    /// disables the budget.
    ///
    /// Measured cause for this field: at n=13..16, attempts that fail after
    /// exhausting `refine_iters` ("itercap" failures, ~9-11% of attempts) account
    /// for 53-65% of total generation CPU time, while successful attempts are on
    /// average *cheaper* than failed ones at every size measured (e.g. at n=16 the
    /// one successful attempt sampled cost 279ms of solver work against a mean
    /// failed-attempt cost of 8.4s and a worst observed failure of 563s). Attempt
    /// cost does not predict success, so bounding it sheds the expensive tail
    /// without materially narrowing the search.
    pub max_nodes: u64,
}

impl GenOptions {
    /// The reference used a flat `restarts = 200`, but it needed 78 restarts at
    /// n=12 — only about 2.5x headroom, and the trend is steep. Scaling with `n`
    /// keeps that margin at larger sizes.
    ///
    /// `max_nodes` is set per-size from direct measurement, not a formula: it was
    /// tuned by running the real `generate_with` (not a proxy) across a range of
    /// candidate budgets and checking both (a) does generation still succeed with
    /// zero failures, and (b) is it actually faster. A budget too tight doesn't
    /// just fail outright — a doomed-but-not-yet-detected attempt still costs up
    /// to the budget before being abandoned, so tightening the budget can *raise*
    /// the number of restarts needed by more than it saves per attempt, making
    /// generation slower, not faster, well before `restarts` is ever exhausted.
    /// That crossover point turned out not to move smoothly with `n`: n=13 needed
    /// a budget of several billion nodes to stay safe, while n=14 tolerated (and
    /// benefited more from) a budget an order of magnitude tighter — reflecting
    /// real differences in each size's tail shape, not something a single
    /// formula should be trusted to extrapolate. So budgets below are only set
    /// where they were directly measured safe; n>=15 is intentionally left
    /// unbounded pending the same measurement (a wrong guess here would make
    /// exactly the sizes that already take tens of seconds to minutes *worse*).
    ///
    /// n=13: 5_000_000_000 verified safe (zero failures across repeated sweeps,
    /// no slowdown) — mean/median generation time roughly unchanged, so the
    /// benefit here is mostly cutting the rare worst-case tail rather than the
    /// typical case.
    /// n=14: 1_000_000_000 verified safe with a real ~49% mean-time reduction
    /// (measured against unbounded: mean 11.8s -> 6.0s over repeated trials);
    /// looser budgets (5B-20B) were also safe but gave smaller wins, and a
    /// tighter one (500M) showed an even bigger win in a single sweep but wasn't
    /// re-verified enough times to trust as the shipped value.
    pub fn for_size(n: usize) -> Self {
        let max_nodes = match n {
            13 => 5_000_000_000,
            14 => 1_000_000_000,
            _ => u64::MAX,
        };
        Self {
            restarts: 200 + 50 * n as u32,
            refine_iters: 40 * n as u32,
            max_nodes,
        }
    }
}

/// A queen permutation with no two queens diagonally adjacent.
///
/// One-per-row and one-per-column already forbid shared rows and columns, so the
/// only constraint left is `|p[r] - p[r+1]| >= 2` between consecutive rows.
/// Returns `None` when no such permutation exists (n = 2 or 3).
pub fn random_solution(n: usize, rng: &mut Rng) -> Option<Vec<u8>> {
    fn place(
        row: usize,
        n: usize,
        placement: &mut Placement,
        used: &mut u32,
        rng: &mut Rng,
    ) -> bool {
        if row == n {
            return true;
        }
        let mut cols: Placement = [0; MAX_N];
        for (i, slot) in cols[..n].iter_mut().enumerate() {
            *slot = i as u8;
        }
        rng.shuffle(&mut cols[..n]);

        for i in 0..n {
            let col = cols[i] as usize;
            if *used & (1 << col) != 0 {
                continue;
            }
            if row > 0 && (placement[row - 1] as i32 - col as i32).abs() < 2 {
                continue;
            }
            placement[row] = col as u8;
            *used |= 1 << col;
            if place(row + 1, n, placement, used, rng) {
                return true;
            }
            *used &= !(1 << col);
        }
        false
    }

    let mut placement: Placement = [0; MAX_N];
    let mut used = 0u32;
    place(0, n, &mut placement, &mut used, rng).then(|| placement[..n].to_vec())
}

/// Grows `n` connected regions outward from the queen cells.
///
/// Region `r`'s seed is the queen in row `r` — **region id equals the row index of
/// its seed**. `refine_unique` relies on that to find a region's seed, so it must
/// not be broken.
pub fn grow_regions(n: usize, queens: &[u8], rng: &mut Rng) -> RegionGrid {
    let mut grid = RegionGrid::unassigned(n);
    let mut frontier: Vec<((usize, usize), u8)> = Vec::new();
    let mut buf = [(0usize, 0usize); 4];

    for (r, &c) in queens.iter().enumerate() {
        let c = c as usize;
        grid.set(r, c, r as u8);
        let count = neighbours(r, c, n, &mut buf);
        for &cell in &buf[..count] {
            frontier.push((cell, r as u8));
        }
    }

    let mut remaining = n * n - n;
    while remaining > 0 && !frontier.is_empty() {
        // The reference pops a uniformly random index, not the front or back —
        // that randomness is what makes region shapes irregular.
        //
        // DEPARTURE: it uses `list.pop(i)`, which preserves the order of the rest;
        // `swap_remove` does not. Since the next index is drawn uniformly over the
        // whole vector either way, the distribution of layouts is unchanged, and
        // this is O(1) instead of O(len).
        let i = rng.gen_range(frontier.len());
        let ((r, c), region) = frontier.swap_remove(i);
        if grid.get(r, c) != UNASSIGNED {
            continue;
        }
        grid.set(r, c, region);
        remaining -= 1;

        let count = neighbours(r, c, n, &mut buf);
        for &(nr, nc) in &buf[..count] {
            if grid.get(nr, nc) == UNASSIGNED {
                frontier.push(((nr, nc), region));
            }
        }
    }

    grid
}

/// Reshapes regions until the intended placement is the only solution.
///
/// While an alternate solution exists, take a cell where the alternate puts a queen
/// but the intended one does not, and move it into a neighbouring region. That
/// forces two of the alternate's queens to share a region, killing it, while the
/// intended solution — which only ever sits on region seeds — stays valid.
///
/// Returns `false` when no legal move remains, so the caller restarts. Also
/// returns `false` — abandoning the attempt early — once `max_nodes` total
/// solver nodes have been spent across the calls made so far, so a doomed
/// attempt cannot run up an unbounded bill before the caller gives up on it.
/// The budget is only ever checked *between* whole `solve` calls, never inside
/// one, so it cannot truncate a search and corrupt the two-witness invariant
/// `refine_unique` depends on.
pub fn refine_unique(
    n: usize,
    queens: &[u8],
    grid: &mut RegionGrid,
    rng: &mut Rng,
    max_iters: u32,
    max_nodes: u64,
) -> bool {
    let is_seed = |r: usize, c: usize| queens[r] as usize == c;
    let mut nodes_spent: u64 = 0;

    for _ in 0..max_iters {
        let mut witnesses = [[0u8; MAX_N]; 2];
        let (count, nodes) = solver::solve_counted(n, grid.as_slice(), 2, &mut witnesses);
        nodes_spent += nodes;
        if count == 1 {
            return true;
        }
        if nodes_spent > max_nodes {
            return false;
        }
        debug_assert_eq!(
            count, 2,
            "the intended placement is always a solution, so there is never zero"
        );

        let alternate = if witnesses[0][..n] != queens[..] {
            witnesses[0]
        } else {
            witnesses[1]
        };

        let mut candidates: Vec<(usize, usize)> = (0..n)
            .map(|r| (r, alternate[r] as usize))
            .filter(|&(r, c)| !is_seed(r, c))
            .collect();
        rng.shuffle(&mut candidates);

        let mut moved = false;
        let mut buf = [(0usize, 0usize); 4];
        for (r, c) in candidates {
            let from = grid.get(r, c);
            // Region ids equal their seed's row, so this is the seed of `from`.
            let seed = (from as usize, queens[from as usize] as usize);

            let count = neighbours(r, c, n, &mut buf);
            let mut adjacent = [0u8; 4];
            let mut adjacent_len = 0;
            for &(nr, nc) in &buf[..count] {
                let other = grid.get(nr, nc);
                if other != from && !adjacent[..adjacent_len].contains(&other) {
                    adjacent[adjacent_len] = other;
                    adjacent_len += 1;
                }
            }
            if adjacent_len == 0 {
                continue;
            }
            rng.shuffle(&mut adjacent[..adjacent_len]);

            // DEPARTURE: the reference evaluates this inside its loop over
            // neighbouring regions, but it does not depend on which one is picked,
            // so it either passes for all of them or none. Hoisting it out is
            // exactly equivalent and skips a repeated flood fill.
            if !grid.is_connected_without(from, seed, (r, c)) {
                continue;
            }

            // The target region stays connected by construction: (r, c) touches it.
            grid.set(r, c, adjacent[0]);
            moved = true;
            break;
        }

        if !moved {
            return false;
        }
    }

    solver::count_solutions(n, grid.as_slice(), 2) == 1
}

/// Generate a board with exactly one solution. The same `seed` always gives the
/// same board.
pub fn generate(n: usize, seed: u32) -> Result<GeneratedBoardCore, GenError> {
    generate_with(n, &mut Rng::from_seed(seed), GenOptions::for_size(n))
}

pub fn generate_with(
    n: usize,
    rng: &mut Rng,
    opts: GenOptions,
) -> Result<GeneratedBoardCore, GenError> {
    if n > MAX_N {
        return Err(GenError::SizeTooLarge { n, max: MAX_N });
    }
    // n = 0 is meaningless in the UI; 2 and 3 admit no valid placement at all.
    if n == 0 || n == 2 || n == 3 {
        return Err(GenError::UnsupportedSize(n));
    }

    for attempt in 1..=opts.restarts {
        let Some(queens) = random_solution(n, rng) else {
            return Err(GenError::UnsupportedSize(n));
        };
        let mut regions = grow_regions(n, &queens, rng);
        if refine_unique(n, &queens, &mut regions, rng, opts.refine_iters, opts.max_nodes) {
            return Ok(GeneratedBoardCore { n, queens, regions, attempts: attempt });
        }
    }

    Err(GenError::Exhausted { n, restarts: opts.restarts })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_solution_is_a_valid_permutation() {
        let mut rng = Rng::from_seed(5);
        for n in [1, 4, 5, 8, 11] {
            let queens = random_solution(n, &mut rng).expect("placement exists");
            assert_eq!(queens.len(), n);
            let mut sorted = queens.clone();
            sorted.sort_unstable();
            assert_eq!(sorted, (0..n as u8).collect::<Vec<_>>());
            for r in 1..n {
                assert!((queens[r] as i32 - queens[r - 1] as i32).abs() >= 2);
            }
        }
    }

    #[test]
    fn random_solution_fails_for_impossible_sizes() {
        let mut rng = Rng::from_seed(1);
        assert!(random_solution(2, &mut rng).is_none());
        assert!(random_solution(3, &mut rng).is_none());
    }

    #[test]
    fn grow_regions_covers_the_grid_with_connected_regions() {
        let mut rng = Rng::from_seed(17);
        for n in [4, 6, 9] {
            let queens = random_solution(n, &mut rng).unwrap();
            let grid = grow_regions(n, &queens, &mut rng);
            assert!(grid.as_slice().iter().all(|&r| (r as usize) < n));
            assert_eq!(grid.region_sizes().iter().sum::<usize>(), n * n);
            assert!(grid.all_regions_connected());
            // Each region's seed is the queen in the row matching its id.
            for (r, &c) in queens.iter().enumerate() {
                assert_eq!(grid.get(r, c as usize), r as u8);
            }
        }
    }
}
