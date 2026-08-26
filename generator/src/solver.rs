//! Enumerates queen placements for a region layout.
//!
//! This is the whole cost of generation — profiling the Python reference showed
//! 99.8% of runtime inside this search, over ~30M recursive calls for a single
//! n=11 board. So it allocates nothing: column and region sets are `u32` bitmasks,
//! placements live in fixed `[u8; MAX_N]` arrays, and the low candidate column is
//! picked with `trailing_zeros()` (one `i32.ctz` instruction in wasm).
//!
//! One queen per row and per column already rules out shared rows and columns, so
//! the only adjacency left to forbid is diagonal contact between consecutive rows.

use crate::MAX_N;

/// A queen placement: `place[r]` is the column of the queen in row `r`.
pub type Placement = [u8; MAX_N];

/// Enumerate up to `limit` solutions, writing the first `out.len()` of them into
/// `out`. Returns how many were found (which may exceed `out.len()`, but never
/// `limit`). Enumeration is low-column-first, matching the reference implementation.
pub fn solve(n: usize, regions: &[u8], limit: usize, out: &mut [Placement]) -> usize {
    solve_counted(n, regions, limit, out).0
}

/// Same search as `solve`, but also returns how many recursive calls it made.
///
/// Exists so a caller that runs many searches per attempt (`refine_unique`) can
/// bound total work without touching the search itself: the counter is a pure
/// addition to `descend` and changes nothing about which branches are visited or
/// in what order, so `solve`'s witnesses and count are unaffected. Not part of the
/// public API — `refine_unique` is the only caller, and the wasm boundary never
/// needs a node count.
pub(crate) fn solve_counted(n: usize, regions: &[u8], limit: usize, out: &mut [Placement]) -> (usize, u64) {
    debug_assert!(n <= MAX_N);
    debug_assert_eq!(regions.len(), n * n);

    let full = if n == 32 { u32::MAX } else { (1u32 << n) - 1 };

    // regions_from[r] = every region id that appears somewhere in rows r..n.
    // Used to prune branches where a region still needing a queen has no rows
    // left to put one in. See `descend`.
    let mut regions_from = [0u32; MAX_N + 1];
    for r in (0..n).rev() {
        let mut row_mask = 0u32;
        for c in 0..n {
            row_mask |= 1 << regions[r * n + c];
        }
        regions_from[r] = regions_from[r + 1] | row_mask;
    }

    let mut search = Search {
        n,
        regions,
        limit,
        out,
        found: 0,
        place: [0; MAX_N],
        full,
        regions_from,
        nodes: 0,
    };
    search.descend(0, 0, 0, -1);
    (search.found, search.nodes)
}

/// How many solutions exist, capped at `limit`.
pub fn count_solutions(n: usize, regions: &[u8], limit: usize) -> usize {
    solve(n, regions, limit, &mut [])
}

struct Search<'a> {
    n: usize,
    regions: &'a [u8],
    limit: usize,
    out: &'a mut [Placement],
    found: usize,
    place: Placement,
    full: u32,
    regions_from: [u32; MAX_N + 1],
    nodes: u64,
}

impl Search<'_> {
    fn descend(&mut self, row: usize, cols_used: u32, regions_used: u32, prev_col: i32) {
        self.nodes += 1;
        if row == self.n {
            if self.found < self.out.len() {
                self.out[self.found] = self.place;
            }
            self.found += 1;
            return;
        }

        // Every region still needing a queen must still have a row to put it in.
        // This only removes subtrees that contain no complete solution, so the
        // sequence of solutions found is unchanged — which matters, because
        // `refine_unique` depends on the enumeration order.
        if (self.full & !regions_used & !self.regions_from[row]) != 0 {
            return;
        }

        // Columns blocked by diagonal contact with the previous row's queen.
        let mut adjacent = 0u32;
        if prev_col >= 0 {
            let prev = prev_col as usize;
            if prev > 0 {
                adjacent |= 1 << (prev - 1);
            }
            if prev + 1 < self.n {
                adjacent |= 1 << (prev + 1);
            }
        }

        let mut available = self.full & !cols_used & !adjacent;
        let row_base = row * self.n;
        while available != 0 {
            let col = available.trailing_zeros() as usize;
            available &= available - 1; // clear the low bit
            let region_bit = 1u32 << self.regions[row_base + col];
            if regions_used & region_bit != 0 {
                continue; // that region already has a queen
            }
            self.place[row] = col as u8;
            self.descend(
                row + 1,
                cols_used | (1 << col),
                regions_used | region_bit,
                col as i32,
            );
            if self.found >= self.limit {
                return;
            }
        }
    }
}

/// The same search with the region-reachability prune removed. Exists only so
/// tests can prove the prune changes nothing observable.
#[cfg(test)]
fn solve_unpruned(n: usize, regions: &[u8], limit: usize, out: &mut [Placement]) -> usize {
    fn descend(
        n: usize,
        regions: &[u8],
        limit: usize,
        out: &mut [Placement],
        found: &mut usize,
        place: &mut Placement,
        full: u32,
        row: usize,
        cols_used: u32,
        regions_used: u32,
        prev_col: i32,
    ) {
        if row == n {
            if *found < out.len() {
                out[*found] = *place;
            }
            *found += 1;
            return;
        }
        let mut adjacent = 0u32;
        if prev_col >= 0 {
            let prev = prev_col as usize;
            if prev > 0 {
                adjacent |= 1 << (prev - 1);
            }
            if prev + 1 < n {
                adjacent |= 1 << (prev + 1);
            }
        }
        let mut available = full & !cols_used & !adjacent;
        while available != 0 {
            let col = available.trailing_zeros() as usize;
            available &= available - 1;
            let region_bit = 1u32 << regions[row * n + col];
            if regions_used & region_bit != 0 {
                continue;
            }
            place[row] = col as u8;
            descend(
                n, regions, limit, out, found, place, full,
                row + 1, cols_used | (1 << col), regions_used | region_bit, col as i32,
            );
            if *found >= limit {
                return;
            }
        }
    }

    let full = if n == 32 { u32::MAX } else { (1u32 << n) - 1 };
    let mut found = 0;
    let mut place = [0u8; MAX_N];
    descend(n, regions, limit, out, &mut found, &mut place, full, 0, 0, 0, -1);
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The 4x4 board from the README example:
    ///
    /// ```text
    /// B B B B
    /// A B C C
    /// C B C D
    /// C C C D
    /// ```
    ///
    /// with the unique solution Q at (0,2) (1,0) (2,3) (3,1).
    const README_REGIONS: [u8; 16] = [
        1, 1, 1, 1, //
        0, 1, 2, 2, //
        2, 1, 2, 3, //
        2, 2, 2, 3,
    ];

    #[test]
    fn finds_the_readme_solution_and_only_that_one() {
        let mut out = [[0u8; MAX_N]; 2];
        let found = solve(4, &README_REGIONS, 2, &mut out);
        assert_eq!(found, 1);
        assert_eq!(&out[0][..4], &[2, 0, 3, 1]);
    }

    #[test]
    fn count_solutions_agrees_with_solve() {
        assert_eq!(count_solutions(4, &README_REGIONS, 2), 1);
    }

    #[test]
    fn respects_the_limit() {
        // Every cell its own row-region: the region rule is vacuous, so plenty of
        // placements survive and the cap is what stops the search.
        let regions: Vec<u8> = (0..8).flat_map(|r| std::iter::repeat_n(r as u8, 8)).collect();
        assert_eq!(count_solutions(8, &regions, 2), 2);
        assert_eq!(count_solutions(8, &regions, 5), 5);
    }

    /// Column stripes (`region[r][c] = c`) make the region rule equivalent to the
    /// column rule, so the count is just the number of valid permutations. Both
    /// numbers below were taken from the Python reference.
    fn column_stripes(n: usize) -> Vec<u8> {
        (0..n).flat_map(|_| 0..n as u8).collect()
    }

    #[test]
    fn column_stripes_counts_match_the_reference() {
        assert_eq!(count_solutions(5, &column_stripes(5), 99), 14);
        assert_eq!(count_solutions(6, &column_stripes(6), 99), 90);
    }

    /// `refine_unique` picks its alternate witness as "whichever of the first two
    /// solutions is not the intended one", so enumeration order is load-bearing and
    /// must stay low-column-first. These two witnesses come from the reference.
    #[test]
    fn enumeration_is_low_column_first() {
        let mut out = [[0u8; MAX_N]; 2];
        let found = solve(6, &column_stripes(6), 2, &mut out);
        assert_eq!(found, 2);
        assert_eq!(&out[0][..6], &[0, 2, 4, 1, 3, 5]);
        assert_eq!(&out[1][..6], &[0, 2, 4, 1, 5, 3]);
    }

    #[test]
    fn a_single_region_admits_nothing() {
        assert_eq!(count_solutions(4, &[0; 16], 2), 0);
    }

    /// The prune must only remove subtrees containing no solution, so counts AND
    /// witness order have to match the unpruned search exactly — `refine_unique`
    /// picks its alternate as "whichever of the first two is not the intended
    /// one", so a reordering there would silently change generated boards.
    #[test]
    fn prune_changes_nothing_observable() {
        use crate::generate::{grow_regions, random_solution};
        use crate::rng::Rng;

        let mut rng = Rng::from_seed(20260825);
        let mut checked = 0;
        for n in [4usize, 5, 6, 7, 8, 9] {
            for _ in 0..40 {
                let queens = random_solution(n, &mut rng).unwrap();
                let grid = grow_regions(n, &queens, &mut rng);
                let regions = grid.as_slice();

                for limit in [1usize, 2, 5, 50] {
                    let mut pruned = [[0u8; MAX_N]; 2];
                    let mut plain = [[0u8; MAX_N]; 2];
                    let a = solve(n, regions, limit, &mut pruned);
                    let b = solve_unpruned(n, regions, limit, &mut plain);
                    assert_eq!(a, b, "count differs at n={n} limit={limit}");
                    assert_eq!(pruned, plain, "witnesses differ at n={n} limit={limit}");
                    checked += 1;
                }
            }
        }
        assert!(checked > 900, "only {checked} comparisons ran");
    }

    /// `solve_counted` is `solve` plus a node counter that `refine_unique`'s node
    /// budget (`GenOptions::max_nodes`) relies on to abandon doomed attempts early.
    /// The counter must be a pure addition: it must never change which solutions
    /// are found, how many, or in what order — `refine_unique` depends on
    /// enumeration order to pick its alternate witness, exactly like the prune
    /// above. This proves `solve_counted`'s `(count, witnesses)` always matches
    /// plain `solve`'s, across the same cases `prune_changes_nothing_observable`
    /// checks, plus that the reported node count is always positive whenever any
    /// searching happened at all.
    #[test]
    fn counted_search_matches_uncounted_search() {
        use crate::generate::{grow_regions, random_solution};
        use crate::rng::Rng;

        let mut rng = Rng::from_seed(20260826);
        let mut checked = 0;
        for n in [4usize, 5, 6, 7, 8, 9] {
            for _ in 0..40 {
                let queens = random_solution(n, &mut rng).unwrap();
                let grid = grow_regions(n, &queens, &mut rng);
                let regions = grid.as_slice();

                for limit in [1usize, 2, 5, 50] {
                    let mut counted_out = [[0u8; MAX_N]; 2];
                    let mut plain_out = [[0u8; MAX_N]; 2];
                    let (counted_found, nodes) =
                        solve_counted(n, regions, limit, &mut counted_out);
                    let plain_found = solve(n, regions, limit, &mut plain_out);
                    assert_eq!(counted_found, plain_found, "count differs at n={n} limit={limit}");
                    assert_eq!(counted_out, plain_out, "witnesses differ at n={n} limit={limit}");
                    assert!(nodes >= 1, "a search that ran should visit at least its root node");
                    checked += 1;
                }
            }
        }
        assert!(checked > 900, "only {checked} comparisons ran");
    }

    #[test]
    fn rejects_diagonally_adjacent_queens() {
        // n=3 cannot be solved: any permutation of 3 columns has |p[r]-p[r+1]| < 2
        // somewhere.
        let regions: Vec<u8> = (0..3).flat_map(|r| std::iter::repeat_n(r as u8, 3)).collect();
        assert_eq!(count_solutions(3, &regions, 2), 0);
    }

    #[test]
    fn trivial_board_has_one_solution() {
        assert_eq!(count_solutions(1, &[0], 2), 1);
    }
}
