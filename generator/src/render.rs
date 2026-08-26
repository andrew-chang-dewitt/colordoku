//! ASCII view of a board, for test failure messages and manual inspection.
//!
//! An 11x11 uniqueness failure is unreadable as a flat array of region ids, so
//! every assertion in the integration tests prints one of these on failure.

use crate::grid::RegionGrid;

/// Draws region borders as box characters and marks queen cells with `Q`.
pub fn render(grid: &RegionGrid, queens: Option<&[u8]>) -> String {
    let n = grid.n();
    let is_queen = |r: usize, c: usize| queens.is_some_and(|q| q[r] as usize == c);

    let bar = format!("+{}+", vec!["---"; n].join("+"));
    let mut lines = vec![bar.clone()];

    for r in 0..n {
        let mut row = String::from("|");
        for c in 0..n {
            row.push_str(if is_queen(r, c) { " Q " } else { " . " });
            let edge = c == n - 1 || grid.get(r, c) != grid.get(r, c + 1);
            row.push(if edge { '|' } else { ' ' });
        }
        lines.push(row);

        if r == n - 1 {
            lines.push(bar.clone());
        } else {
            let mut sep = String::from("+");
            for c in 0..n {
                sep.push_str(if grid.get(r, c) != grid.get(r + 1, c) {
                    "---"
                } else {
                    "   "
                });
                sep.push('+');
            }
            lines.push(sep);
        }
    }

    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_readme_board() {
        let grid = RegionGrid::from_vec(
            4,
            vec![
                1, 1, 1, 1, //
                0, 1, 2, 2, //
                2, 1, 2, 3, //
                2, 2, 2, 3,
            ],
        );
        let drawn = render(&grid, Some(&[2, 0, 3, 1]));
        // One Q per row, and the grid is square.
        assert_eq!(drawn.matches('Q').count(), 4);
        assert!(drawn.lines().all(|l| l.len() == drawn.lines().next().unwrap().len()));
    }

    #[test]
    fn renders_without_queens() {
        let grid = RegionGrid::from_vec(1, vec![0]);
        assert!(!render(&grid, None).contains('Q'));
    }
}
