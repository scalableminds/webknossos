//! Unsigned Neuroglancer sharding, compressed Morton IDs and range-readable indexes.
use crate::{
    compression::Compressor,
    datareaders::{assert_chunk_size_limit, index_cache::IndexCache},
    datavault::{ByteRange, VaultError, VaultPath, VaultResult},
    error::{DsError, DsResult},
};
use serde::{Deserialize, Serialize};
fn raw() -> String {
    "raw".into()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShardingSpecification {
    #[serde(rename = "@type")]
    pub kind: String,
    pub preshift_bits: u32,
    pub hash: String,
    pub minishard_bits: u32,
    pub shard_bits: u32,
    #[serde(default = "raw")]
    pub minishard_index_encoding: String,
    #[serde(default = "raw")]
    pub data_encoding: String,
}
impl ShardingSpecification {
    pub fn validate(&self) -> DsResult<()> {
        if self.kind != "neuroglancer_uint64_sharded_v1"
            || self.preshift_bits > 63
            || self.minishard_bits > 24
            || self.shard_bits > 64
            || self.minishard_bits + self.shard_bits > 64
        {
            return Err(DsError::failure(
                "Invalid Neuroglancer sharding bit specification",
            ));
        }
        if !["identity", "murmurhash3_x86_128"].contains(&self.hash.as_str()) {
            return Err(DsError::failure(format!(
                "Unsupported hash function: {}",
                self.hash
            )));
        }
        if !["raw", "gzip"].contains(&self.minishard_index_encoding.as_str())
            || !["raw", "gzip"].contains(&self.data_encoding.as_str())
        {
            return Err(DsError::failure(
                "Unsupported Neuroglancer sharding encoding",
            ));
        }
        assert_chunk_size_limit(self.index_length() as i64)
    }
    pub fn index_length(&self) -> u64 {
        16u64 << self.minishard_bits
    }
    pub fn minishard_info(&self, id: u64) -> (u64, u64) {
        let shifted = id >> self.preshift_bits;
        let hash = if self.hash == "identity" {
            shifted
        } else {
            murmurhash3_x86_128_low64(shifted)
        };
        let mask = |bits: u32| {
            if bits == 64 {
                u64::MAX
            } else {
                (1u64 << bits) - 1
            }
        };
        let mini = hash & mask(self.minishard_bits);
        let shard = if self.minishard_bits == 64 {
            0
        } else {
            (hash >> self.minishard_bits) & mask(self.shard_bits)
        };
        (shard, mini)
    }
    pub fn shard_filename(&self, number: u64) -> String {
        format!(
            "{number:0width$x}.shard",
            width = self.shard_bits.div_ceil(4).max(1) as usize
        )
    }
}
/// Scala hashes exactly eight little-endian bytes for a uint64 ID, with seed zero.
pub fn murmurhash3_x86_128_low64(input: u64) -> u64 {
    let mut h1 = (input as u32)
        .wrapping_mul(0x239b961b)
        .rotate_left(15)
        .wrapping_mul(0xab0e9789);
    let mut h2 = ((input >> 32) as u32)
        .wrapping_mul(0xab0e9789)
        .rotate_left(16)
        .wrapping_mul(0x38b34ae5);
    let mut h3 = 0u32;
    let mut h4 = 0u32;
    h1 ^= 8;
    h2 ^= 8;
    h3 ^= 8;
    h4 ^= 8;
    h1 = h1.wrapping_add(h2).wrapping_add(h3).wrapping_add(h4);
    h2 = h2.wrapping_add(h1);
    h3 = h3.wrapping_add(h1);
    h4 = h4.wrapping_add(h1);
    let fmix = |mut h: u32| {
        h ^= h >> 16;
        h = h.wrapping_mul(0x85ebca6b);
        h ^= h >> 13;
        h = h.wrapping_mul(0xc2b2ae35);
        h ^ (h >> 16)
    };
    h1 = fmix(h1);
    h2 = fmix(h2);
    h3 = fmix(h3);
    h4 = fmix(h4);
    h1 = h1.wrapping_add(h2).wrapping_add(h3).wrapping_add(h4);
    h2 = h1.wrapping_add(h2);
    u64::from(h1) | (u64::from(h2) << 32)
}
pub fn compressed_morton_code(position: [u32; 3], grid: [u32; 3]) -> DsResult<u64> {
    if grid.contains(&0) || position.iter().zip(grid).any(|(p, g)| *p >= g) {
        return Err(DsError::failure("Compressed Morton position exceeds grid"));
    }
    let bits = grid.map(|g| 32 - (g - 1).leading_zeros());
    if bits.iter().sum::<u32>() > 64 {
        return Err(DsError::failure("Compressed Morton code exceeds 64 bits"));
    }
    let mut result = 0u64;
    let mut output = 0;
    for bit in 0..*bits.iter().max().unwrap() {
        for d in 0..3 {
            if bit < bits[d] {
                result |= u64::from((position[d] >> bit) & 1) << output;
                output += 1;
            }
        }
    }
    Ok(result)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MinishardEntry {
    pub id: u64,
    pub offset: u64,
    pub size: u64,
}
pub fn parse_minishard_index(bytes: &[u8]) -> DsResult<Vec<MinishardEntry>> {
    if !bytes.len().is_multiple_of(24) {
        return Err(DsError::failure("Malformed Neuroglancer minishard index"));
    }
    let words: Vec<u64> = bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|b| u64::from_le_bytes(*b))
        .collect();
    let n = bytes.len() / 24;
    let mut result = Vec::with_capacity(n);
    let mut id = 0u64;
    let mut offset = 0u64;
    // Offset deltas are measured relative to the end of the previous payload, not its start.
    for i in 0..n {
        id = id.wrapping_add(words[i]);
        offset = offset
            .wrapping_add(if i == 0 { 0 } else { words[2 * n + i - 1] })
            .wrapping_add(words[n + i]);
        let size = words[2 * n + i];
        offset
            .checked_add(size)
            .ok_or_else(|| DsError::failure("Neuroglancer chunk range overflow"))?;
        result.push(MinishardEntry { id, offset, size });
    }
    Ok(result)
}
#[derive(Debug)]
pub(crate) struct ShardReader {
    pub spec: ShardingSpecification,
    shards: IndexCache<Vec<u8>>,
    minishards: IndexCache<Vec<MinishardEntry>>,
}
impl ShardReader {
    pub fn new(spec: ShardingSpecification) -> Self {
        Self {
            spec,
            shards: IndexCache::default(),
            minishards: IndexCache::default(),
        }
    }
    pub async fn chunk_path_and_range(
        &self,
        root: &VaultPath,
        id: u64,
        token: Option<&str>,
    ) -> VaultResult<(VaultPath, ByteRange)> {
        let (shard, mini) = self.spec.minishard_info(id);
        let path = root.join(&self.spec.shard_filename(shard));
        let base = self.spec.index_length();
        let entries = self
            .minishards
            .get_or_load(&format!("{path}#{mini}"), || async {
                let index = self
                    .shards
                    .get_or_load(&path.to_string(), || async {
                        let bytes = path
                            .read_bytes(
                                ByteRange::StartEnd {
                                    start: 0,
                                    end: base,
                                },
                                token,
                            )
                            .await?;
                        if bytes.len() as u64 != base {
                            return Err(VaultError::failure("Truncated Neuroglancer shard index"));
                        }
                        Ok(bytes.to_vec())
                    })
                    .await?;
                let pos = mini as usize * 16;
                let pair = index
                    .get(pos..pos + 16)
                    .ok_or_else(|| VaultError::failure("Invalid minishard number"))?;
                let start = u64::from_le_bytes(pair[..8].try_into().expect("8 bytes"));
                let end = u64::from_le_bytes(pair[8..].try_into().expect("8 bytes"));
                if start == end {
                    return Ok(Vec::new());
                }
                if end < start {
                    return Err(VaultError::failure("Invalid Neuroglancer minishard range"));
                }
                assert_chunk_size_limit(i64::try_from(end - start).unwrap_or(i64::MAX))
                    .map_err(VaultError::from)?;
                let range = ByteRange::StartEnd {
                    start: base
                        .checked_add(start)
                        .ok_or_else(|| VaultError::failure("Minishard offset overflow"))?,
                    end: base
                        .checked_add(end)
                        .ok_or_else(|| VaultError::failure("Minishard offset overflow"))?,
                };
                let bytes = path.read_bytes(range, token).await?;
                let decoded = if self.spec.minishard_index_encoding == "gzip" && !bytes.is_empty() {
                    Compressor::from_precomputed_sharding_encoding("gzip")
                        .and_then(|c| c.decompress(&bytes, Some(300 * 1024 * 1024)))
                        .map_err(VaultError::from)?
                } else {
                    bytes.to_vec()
                };
                parse_minishard_index(&decoded).map_err(VaultError::from)
            })
            .await?;
        let entry = entries
            .iter()
            .find(|e| e.id == id)
            .ok_or(VaultError::NotFound)?;
        let start = base
            .checked_add(entry.offset)
            .ok_or_else(|| VaultError::failure("Chunk offset overflow"))?;
        let end = start
            .checked_add(entry.size)
            .ok_or_else(|| VaultError::failure("Chunk range overflow"))?;
        if end > i64::MAX as u64 || entry.size > 1024 * 1024 * 1024 {
            return Err(VaultError::failure("Invalid Neuroglancer chunk range"));
        }
        Ok((path, ByteRange::StartEnd { start, end }))
    }
}
