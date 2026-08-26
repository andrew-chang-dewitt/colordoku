//! The region grid and its connectivity checks.

use crate::MAX_N;

/// Marks a cell no region has claimed yet.
pub const UNASSIGNED: u8 = u8::MAX;

/// Orthogonal neighbour offsets, in the same order as the Python reference.
const OFFSETS: [(i32, i32); 4] = [(1, 0), (-1, 0), (0, 1), (0, -1)];

/// Writes the in-bounds orthogonal neighbours of `(r, c)` into `out` and returns
/// how many there were. Allocation-free so it can sit in the refinement loop.
pub fn neighbours(r: usize, c: usize, n: usize, out: &mut [(usize, usize); 4]) -> usize {
    let mut count = 0;
    for (dr, dc) in OFFSETS {
        let nr = r as i32 + dr;
        let nc = c as i32 + dc;
        if nr >= 0 && nr < n as i32 && nc >= 0 && nc < n as i32 {
            out[count] = (nr as usize, nc as usize);
            count += 1;
        }
    }
    count
}

/// Row-major grid of region ids; mirrors the reference's `region_of[r][c]`.
///
/// Flat rather than nested so it is one allocation, and so it is already the exact
/// `Vec<u8>` the WASM boundary hands to JavaScript — no conversion pass.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RegionGrid {
    n: usize,
    cells: Vec<u8>,
}

impl RegionGrid {
    pub fn unassigned(n: usize) -> Self {
        Self { n, cells: vec![UNASSIGNED; n * n] }
    }

    pub fn from_vec(n: usize, cells: Vec<u8>) -> Self {
        assert_eq!(cells.len(), n * n, "region grid must be n*n");
        Self { n, cells }
    }

    pub fn n(&self) -> usize {
        self.n
    }

    #[inline]
    pub fn get(&self, r: usize, c: usize) -> u8 {
        self.cells[r * self.n + c]
    }

    #[inline]
    pub fn set(&mut self, r: usize, c: usize, region: u8) {
        self.cells[r * self.n + c] = region;
    }

    pub fn as_slice(&self) -> &[u8] {
        &self.cells
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.cells
    }

    /// Region sizes, largest first.
    pub fn region_sizes(&self) -> Vec<usize> {
        let mut counts = vec![0usize; self.n];
        for &region in &self.cells {
            if (region as usize) < self.n {
                counts[region as usize] += 1;
            }
        }
        counts.sort_unstable_by(|a, b| b.cmp(a));
        counts
    }

    /// Would region `region` still be non-empty and connected with `drop` removed?
    ///
    /// `seed` is the region's queen cell, which must survive — a region that loses
    /// its seed can no longer host the intended solution.
    ///
    /// Membership is held as one `u32` bitmask per row and bits are cleared as they
    /// are visited, so the flood fill needs no separate "seen" set.
    pub fn is_connected_without(
        &self,
        region: u8,
        seed: (usize, usize),
        drop: (usize, usize),
    ) -> bool {
        if seed == drop {
            return false;
        }

        let mut rows = [0u32; MAX_N];
        let mut total = 0usize;
        for r in 0..self.n {
            for c in 0..self.n {
                if self.get(r, c) == region && (r, c) != drop {
                    rows[r] |= 1 << c;
                    total += 1;
                }
            }
        }
        if total == 0 {
            return false;
        }

        let mut stack = Vec::with_capacity(total);
        rows[seed.0] &= !(1 << seed.1);
        stack.push(seed);
        let mut reached = 1usize;

        let mut buf = [(0usize, 0usize); 4];
        while let Some((r, c)) = stack.pop() {
            let count = neighbours(r, c, self.n, &mut buf);
            for &(nr, nc) in &buf[..count] {
                if rows[nr] & (1 << nc) != 0 {
                    rows[nr] &= !(1 << nc);
                    reached += 1;
                    stack.push((nr, nc));
                }
            }
        }

        reached == total
    }

    /// Every region `0..n` is non-empty and orthogonally connected.
    pub fn all_regions_connected(&self) -> bool {
        for region in 0..self.n as u8 {
            let Some(start) = (0..self.n)
                .flat_map(|r| (0..self.n).map(move |c| (r, c)))
                .find(|&(r, c)| self.get(r, c) == region)
            else {
                return false; // empty region
            };
            // A region is connected iff dropping a cell it does not contain leaves
            // it connected; (n, n) is out of bounds so it can never be a member.
            if !self.is_connected_without(region, start, (usize::MAX, usize::MAX)) {
                return false;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neighbours_at_a_corner() {
        let mut buf = [(0, 0); 4];
        assert_eq!(neighbours(0, 0, 4, &mut buf), 2);
        assert_eq!(&buf[..2], &[(1, 0), (0, 1)]);
    }

    #[test]
    fn neighbours_on_an_edge() {
        let mut buf = [(0, 0); 4];
        assert_eq!(neighbours(0, 2, 4, &mut buf), 3);
    }

    #[test]
    fn neighbours_in_the_interior_follow_reference_order() {
        let mut buf = [(0, 0); 4];
        assert_eq!(neighbours(1, 1, 4, &mut buf), 4);
        assert_eq!(&buf[..], &[(2, 1), (0, 1), (1, 2), (1, 0)]);
    }

    /// ```text
    /// 0 0 0 1
    /// 1 1 1 1
    /// ```
    /// as a 4x4 padded with region 1 elsewhere.
    fn line_grid() -> RegionGrid {
        RegionGrid::from_vec(
            4,
            vec![
                0, 0, 0, 1, //
                1, 1, 1, 1, //
                1, 1, 1, 1, //
                1, 1, 1, 1,
            ],
        )
    }

    #[test]
    fn dropping_the_middle_of_a_line_disconnects_it() {
        assert!(!line_grid().is_connected_without(0, (0, 0), (0, 1)));
    }

    #[test]
    fn dropping_the_end_of_a_line_keeps_it_connected() {
        assert!(line_grid().is_connected_without(0, (0, 0), (0, 2)));
    }

    #[test]
    fn dropping_the_seed_is_rejected() {
        assert!(!line_grid().is_connected_without(0, (0, 0), (0, 0)));
    }

    #[test]
    fn emptying_a_region_is_rejected() {
        let grid = RegionGrid::from_vec(2, vec![0, 1, 1, 1]);
        assert!(!grid.is_connected_without(0, (0, 0), (0, 0)));
    }

    /// The README's worked example, which uses all four regions of a 4x4.
    fn readme_grid() -> RegionGrid {
        RegionGrid::from_vec(
            4,
            vec![
                1, 1, 1, 1, //
                0, 1, 2, 2, //
                2, 1, 2, 3, //
                2, 2, 2, 3,
            ],
        )
    }

    #[test]
    fn all_regions_connected_accepts_contiguous_regions() {
        assert!(readme_grid().all_regions_connected());
    }

    #[test]
    fn all_regions_connected_rejects_a_missing_region() {
        // line_grid only ever uses regions 0 and 1, so on a 4x4 two regions are
        // empty — which is exactly what a half-grown board looks like.
        assert!(!line_grid().all_regions_connected());
    }

    #[test]
    fn all_regions_connected_rejects_a_split_region() {
        // Region 0 sits in two opposite corners with no path between them.
        let grid = RegionGrid::from_vec(
            2,
            vec![
                0, 1, //
                1, 0,
            ],
        );
        assert!(!grid.all_regions_connected());
    }

    #[test]
    fn region_sizes_are_descending() {
        assert_eq!(readme_grid().region_sizes(), vec![7, 6, 2, 1]);
    }
}
