//! Helpers shared by the unit tests of several modules.

/// A small deterministic pseudo random generator (xorshift64*), so the tests need no dependency.
pub struct Random(pub u64);

impl Random {
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    pub fn below(&mut self, bound: usize) -> usize {
        (self.next() % bound as u64) as usize
    }

    pub fn chance(&mut self, probability: f64) -> bool {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 <= probability
    }
}

/// Whether the voxel at `[x, y, z]` lies within the ball of `radius` around `center`, all in voxels.
pub fn in_ball([x, y, z]: [usize; 3], center: [f64; 3], radius: f64) -> bool {
    let d = [
        x as f64 - center[0],
        y as f64 - center[1],
        z as f64 - center[2],
    ];
    d[0] * d[0] + d[1] * d[1] + d[2] * d[2] <= radius * radius
}
