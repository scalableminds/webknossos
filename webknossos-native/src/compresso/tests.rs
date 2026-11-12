use super::*;
use std::time::{Duration, Instant};

const MAX_OUTPUT_LENGTH: i32 = 1024 * 1024 * 1024;

/// A deterministic pseudo random number generator (SplitMix64), to avoid a dependency.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

/// Labels of a volume of `shape` (x fastest): a few overlapping blobs on a background of 0, or uniform noise.
fn volume(rng: &mut Rng, shape: [usize; 3], blobs: usize, noise: bool) -> Vec<u64> {
    let centers: Vec<([f64; 3], f64, u64)> = (0..blobs)
        .map(|_| {
            let center = shape.map(|size| rng.below(size) as f64);
            let radius = 2.0 + rng.below(shape[0].max(shape[1]) / 2) as f64;
            (center, radius, rng.next() >> rng.below(64))
        })
        .collect();
    let mut labels = Vec::with_capacity(shape.iter().product());
    for z in 0..shape[2] {
        for y in 0..shape[1] {
            for x in 0..shape[0] {
                if noise {
                    labels.push(rng.below(4) as u64);
                    continue;
                }
                let position = [x as f64, y as f64, z as f64];
                let label = centers.iter().rev().find(|(center, radius, _)| {
                    position
                        .iter()
                        .zip(center)
                        .map(|(p, c)| (p - c) * (p - c))
                        .sum::<f64>()
                        < radius * radius
                });
                labels.push(label.map_or(0, |(_, _, label)| *label));
            }
        }
    }
    labels
}

fn compress<T: compresso::Label>(labels: &[T], shape: [usize; 3], six_connected: bool) -> Vec<u8> {
    let connectivity = if six_connected {
        compresso::Connectivity::Six
    } else {
        compresso::Connectivity::Four
    };
    let options = compresso::CompressOptions::default().connectivity(connectivity);
    compresso::compress(labels, shape, &options).unwrap()
}

/// Compresso streams of all label widths, both connectivities and odd shapes, with the labels they encode.
fn corpus() -> Vec<(String, Vec<u8>, Labels)> {
    let mut rng = Rng(1);
    let cases = [
        ("blobs", 1, [32, 32, 32], 6, false, false),
        ("blobs", 2, [32, 32, 32], 6, false, true),
        ("blobs", 4, [64, 64, 16], 10, false, false),
        ("blobs", 8, [64, 64, 16], 10, false, true),
        ("blobs", 4, [17, 23, 5], 4, false, false),
        ("blobs", 8, [128, 128, 1], 12, false, false),
        ("blobs", 8, [32, 32, 32], 8, false, true),
        ("constant", 4, [32, 32, 32], 0, false, false),
        ("noise", 2, [16, 16, 16], 0, true, false),
    ];
    cases
        .into_iter()
        .map(|(kind, width, shape, blobs, noise, six_connected)| {
            let mut labels = volume(&mut rng, shape, blobs, noise);
            if kind == "constant" {
                labels.fill(1234);
            }
            let (input, labels) = match width {
                1 => {
                    let labels: Vec<u8> = labels.iter().map(|&label| label as u8).collect();
                    (compress(&labels, shape, six_connected), Labels::U8(labels))
                }
                2 => {
                    let labels: Vec<u16> = labels.iter().map(|&label| label as u16).collect();
                    (compress(&labels, shape, six_connected), Labels::U16(labels))
                }
                4 => {
                    let labels: Vec<u32> = labels.iter().map(|&label| label as u32).collect();
                    (compress(&labels, shape, six_connected), Labels::U32(labels))
                }
                _ => (compress(&labels, shape, six_connected), Labels::U64(labels)),
            };
            let [x, y, z] = shape;
            let connectivity = if six_connected { 6 } else { 4 };
            (
                format!("{kind}_{x}x{y}x{z}_width{width}_c{connectivity}"),
                input,
                labels,
            )
        })
        .collect()
}

#[test]
fn decodes_the_corpus() {
    for (name, input, labels) in corpus() {
        let output =
            decompress(&input, MAX_OUTPUT_LENGTH).unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(output.as_le_bytes(), labels.as_le_bytes(), "{name}");
        assert_eq!(
            output.as_le_bytes().len() as u64,
            output_length_from_header(&input),
            "{name}"
        );
    }
}

#[test]
fn checks_the_header_before_decoding() {
    let (_, input, _) = &corpus()[0];
    let length = output_length_from_header(input) as i32;
    assert!(decompress(&input[..HEADER_SIZE - 1], MAX_OUTPUT_LENGTH).is_err());
    assert!(decompress(&[], MAX_OUTPUT_LENGTH).is_err());
    assert!(decompress(input, -1).is_err());
    assert!(decompress(input, length - 1).is_err());
    assert!(decompress(input, length).is_ok());
    assert!(decompress(&input[..HEADER_SIZE], MAX_OUTPUT_LENGTH).is_err());

    // A header declaring a huge volume (65535^3 voxels of 8 bytes) is rejected without decoding.
    let mut huge = input.clone();
    huge[5] = 8;
    huge[6..12].fill(0xff);
    assert!(decompress(&huge, i32::MAX).is_err());

    // A zero-sized volume is rejected as well.
    let mut empty = input.clone();
    empty[10..12].fill(0);
    assert!(decompress(&empty, MAX_OUTPUT_LENGTH).is_err());
}

/// Runs one corrupted input. It must return (Ok or Err) without panicking. The time it takes is only reported,
/// not asserted, as it depends on the machine and on debug vs. release builds.
fn check_corruption(description: &str, input: &[u8], slowest: &mut (Duration, String)) {
    let start = Instant::now();
    let result = std::panic::catch_unwind(|| decompress(input, MAX_OUTPUT_LENGTH));
    let elapsed = start.elapsed();
    match result {
        Ok(Ok(output)) => assert_eq!(
            output.as_le_bytes().len() as u64,
            output_length_from_header(input),
            "{description}"
        ),
        Ok(Err(_)) => {}
        Err(_) => panic!("decompress panicked on {description}"),
    }
    if elapsed > slowest.0 {
        *slowest = (elapsed, description.to_string());
    }
}

#[test]
fn survives_corrupted_input() {
    let mut rng = Rng(42);
    let mut slowest = (Duration::ZERO, String::new());
    let mut cases = 0;
    for (name, input, _) in corpus() {
        // Truncations at every length up to the end of the section tables, then spread over the rest.
        let step = (input.len() / 200).max(1);
        for length in (0..input.len()).filter(|&length| length < 256 || length % step == 0) {
            check_corruption(
                &format!("{name} truncated to {length}"),
                &input[..length],
                &mut slowest,
            );
            cases += 1;
        }
        // Single byte flips at random positions (half of them in the header).
        for i in 0..400 {
            let mut corrupted = input.clone();
            let position = if i % 2 == 0 {
                rng.below(HEADER_SIZE)
            } else {
                rng.below(input.len())
            };
            let mask = (rng.below(255) + 1) as u8;
            corrupted[position] ^= mask;
            check_corruption(
                &format!("{name} byte {position} ^= {mask:#04x}"),
                &corrupted,
                &mut slowest,
            );
            cases += 1;
        }
        // Several random bytes overwritten in the body.
        for _ in 0..100 {
            let mut corrupted = input.clone();
            let count = rng.below(8) + 1;
            for _ in 0..count {
                let position = HEADER_SIZE + rng.below(input.len() - HEADER_SIZE);
                corrupted[position] = rng.next() as u8;
            }
            check_corruption(
                &format!("{name} {count} random body bytes (seeded)"),
                &corrupted,
                &mut slowest,
            );
            cases += 1;
        }
        // Random headers with small sizes and plausible fields in front of the original body.
        for _ in 0..200 {
            let mut corrupted = input.clone();
            corrupted[4] = rng.below(3) as u8; // format version 0, 1 or invalid 2
            corrupted[5] = [1, 2, 4, 8, 3][rng.below(5)];
            for axis in 0..3 {
                let size = rng.below(70) as u16;
                corrupted[6 + 2 * axis..8 + 2 * axis].copy_from_slice(&size.to_le_bytes());
            }
            for step in &mut corrupted[12..15] {
                *step = rng.below(10) as u8;
            }
            corrupted[15..23].copy_from_slice(&(rng.below(5000) as u64).to_le_bytes());
            corrupted[23..27].copy_from_slice(&(rng.below(300) as u32).to_le_bytes());
            corrupted[27..35].copy_from_slice(&(rng.below(5000) as u64).to_le_bytes());
            corrupted[35] = [4, 6, 5][rng.below(3)];
            let header = corrupted[..HEADER_SIZE]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            check_corruption(
                &format!("{name} with header {header}"),
                &corrupted,
                &mut slowest,
            );
            cases += 1;
        }
    }
    assert!(cases > 3000, "only {cases} cases");
    eprintln!(
        "{cases} corrupted inputs, slowest {:?}: {}",
        slowest.0, slowest.1
    );
}
