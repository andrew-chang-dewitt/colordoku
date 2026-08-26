//! xoshiro256** seeded through splitmix64.
//!
//! Hand-rolled rather than pulled from `rand` so the crate has no dependencies at
//! all: `getrandom` needs an extra backend feature and a `--cfg` flag to build for
//! wasm32-unknown-unknown, and none of that is worth it for a PRNG we seed from JS
//! anyway. Seeding from the caller also means every board is reproducible from its
//! seed, which the tests rely on.

pub struct Rng {
    s: [u64; 4],
}

impl Rng {
    pub fn from_seed(seed: u32) -> Self {
        let mut state = seed as u64;
        let mut s = [0u64; 4];
        for slot in s.iter_mut() {
            *slot = splitmix64(&mut state);
        }
        // xoshiro is degenerate if every word is zero. splitmix64 never emits four
        // zeroes in a row, but the guard costs nothing.
        if s.iter().all(|&w| w == 0) {
            s[0] = 0x9E37_79B9_7F4A_7C15;
        }
        Self { s }
    }

    pub fn next_u64(&mut self) -> u64 {
        let result = self.s[1].wrapping_mul(5).rotate_left(7).wrapping_mul(9);
        let t = self.s[1] << 17;

        self.s[2] ^= self.s[0];
        self.s[3] ^= self.s[1];
        self.s[1] ^= self.s[2];
        self.s[0] ^= self.s[3];
        self.s[2] ^= t;
        self.s[3] = self.s[3].rotate_left(45);

        result
    }

    /// Uniform integer in `0..n`, via Lemire's multiply-shift with rejection.
    pub fn gen_range(&mut self, n: usize) -> usize {
        debug_assert!(n > 0, "gen_range needs a non-empty range");
        let bound = n as u64;
        let mut product = (self.next_u64() as u128) * (bound as u128);
        let mut low = product as u64;
        if low < bound {
            // Reject the small window that would otherwise be over-represented.
            let threshold = bound.wrapping_neg() % bound;
            while low < threshold {
                product = (self.next_u64() as u128) * (bound as u128);
                low = product as u64;
            }
        }
        (product >> 64) as usize
    }

    /// Fisher-Yates.
    pub fn shuffle<T>(&mut self, slice: &mut [T]) {
        for i in (1..slice.len()).rev() {
            let j = self.gen_range(i + 1);
            slice.swap(i, j);
        }
    }
}

fn splitmix64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_yields_same_stream() {
        let mut a = Rng::from_seed(12345);
        let mut b = Rng::from_seed(12345);
        for _ in 0..1000 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seeds_diverge() {
        let mut a = Rng::from_seed(1);
        let mut b = Rng::from_seed(2);
        assert_ne!(a.next_u64(), b.next_u64());
    }

    /// Snapshot of this implementation's own output, not an upstream test vector
    /// (published xoshiro vectors assume a directly-specified state, not our
    /// splitmix64-from-u32 seeding). Its job is to catch an accidental edit to the
    /// constants, which would silently change every board anyone has a seed for.
    #[test]
    fn matches_known_vector() {
        let mut rng = Rng::from_seed(0);
        let got: Vec<u64> = (0..4).map(|_| rng.next_u64()).collect();
        assert_eq!(
            got,
            vec![
                11091344671253066420,
                13793997310169335082,
                1900383378846508768,
                7684712102626143532,
            ]
        );
    }

    #[test]
    fn gen_range_stays_in_bounds() {
        let mut rng = Rng::from_seed(7);
        for bound in 1..=20usize {
            for _ in 0..500 {
                assert!(rng.gen_range(bound) < bound);
            }
        }
    }

    #[test]
    fn gen_range_covers_every_value() {
        let mut rng = Rng::from_seed(9);
        let mut seen = [false; 6];
        for _ in 0..2000 {
            seen[rng.gen_range(6)] = true;
        }
        assert!(seen.iter().all(|&s| s));
    }

    #[test]
    fn shuffle_is_a_permutation() {
        let mut rng = Rng::from_seed(99);
        let mut v: Vec<u32> = (0..64).collect();
        rng.shuffle(&mut v);
        let mut sorted = v.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..64).collect::<Vec<_>>());
        assert_ne!(v, sorted, "a 64-element shuffle should not come back sorted");
    }

    #[test]
    fn shuffle_handles_degenerate_slices() {
        let mut rng = Rng::from_seed(3);
        let mut empty: [u8; 0] = [];
        rng.shuffle(&mut empty);
        let mut single = [42u8];
        rng.shuffle(&mut single);
        assert_eq!(single, [42]);
    }
}
