use core::fmt;

/// These messages surface verbatim as the `message` of a JavaScript `Error`, so
/// they are written for a person reading them in a browser.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GenError {
    /// No valid queen placement exists at this size. True for 0, 2, and 3.
    UnsupportedSize(usize),
    SizeTooLarge { n: usize, max: usize },
    /// Ran out of restarts without landing on a uniquely-solvable layout.
    Exhausted { n: usize, restarts: u32 },
}

impl fmt::Display for GenError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GenError::UnsupportedSize(n) => write!(
                f,
                "no valid board exists at size {n} (only 1 and 4 or more are possible)"
            ),
            GenError::SizeTooLarge { n, max } => {
                write!(f, "board size {n} is too large (maximum is {max})")
            }
            GenError::Exhausted { n, restarts } => write!(
                f,
                "gave up generating a {n}x{n} board with exactly one solution after {restarts} attempts"
            ),
        }
    }
}

impl core::error::Error for GenError {}
