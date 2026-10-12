//! Scala ZipDataVault: stored entries, ZIP64 metadata and bounded outer-vault range reads.
use super::{
    BoxFuture, ByteRange, DataVault, Encoding, RawRead, UPath, VaultError, VaultPath, VaultResult,
};
use crate::{error::DsError, wk_client::AlfuCache};
use std::{collections::HashMap, fmt, sync::Arc, time::Duration};

const EOCD: u32 = 0x06054b50;
const LOCATOR64: u32 = 0x07064b50;
const EOCD64: u32 = 0x06064b50;
const CENTRAL: u32 = 0x02014b50;
const SEARCH_BYTES: u64 = 65 * 1024 + 22;
const MAX_DIRECTORY_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ENTRIES: usize = 1_000_000;
const MAX_READ_BYTES: u64 = 300 * 1024 * 1024;

#[derive(Clone)]
struct Entry {
    offset: u64,
    compressed: u64,
    size: u64,
    method: u16,
    name: String,
}
struct Directory {
    entries: Vec<Entry>,
    by_name: HashMap<String, usize>,
    listing_order: Vec<usize>,
}

pub struct ZipDataVault {
    outer: VaultPath,
    directory: AlfuCache<(), Arc<Directory>>,
}
impl fmt::Debug for ZipDataVault {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ZipDataVault")
            .field("outer", &self.outer)
            .finish()
    }
}
fn failure(message: impl Into<String>) -> VaultError {
    VaultError::failure(message)
}
fn bytes_at(bytes: &[u8], offset: usize, count: usize) -> VaultResult<&[u8]> {
    bytes
        .get(
            offset
                ..offset
                    .checked_add(count)
                    .ok_or_else(|| failure("Zip metadata offset overflow"))?,
        )
        .ok_or_else(|| failure("Truncated zip metadata"))
}
fn u16_at(bytes: &[u8], offset: usize) -> VaultResult<u16> {
    Ok(u16::from_le_bytes(
        bytes_at(bytes, offset, 2)?.try_into().expect("two bytes"),
    ))
}
fn u32_at(bytes: &[u8], offset: usize) -> VaultResult<u32> {
    Ok(u32::from_le_bytes(
        bytes_at(bytes, offset, 4)?.try_into().expect("four bytes"),
    ))
}
fn u64_at(bytes: &[u8], offset: usize) -> VaultResult<u64> {
    let value = u64::from_le_bytes(bytes_at(bytes, offset, 8)?.try_into().expect("eight bytes"));
    if value > i64::MAX as u64 {
        return Err(failure("ZIP64 size or offset exceeds signed 64-bit range"));
    }
    Ok(value)
}
fn checked_add(a: u64, b: u64) -> VaultResult<u64> {
    a.checked_add(b)
        .filter(|n| *n <= i64::MAX as u64)
        .ok_or_else(|| failure("Zip byte range overflow"))
}
fn normalize(name: &str) -> &str {
    let name = name.strip_prefix('/').unwrap_or(name);
    name.strip_suffix('/').unwrap_or(name)
}
fn inner(path: &UPath) -> VaultResult<&str> {
    match path {
        UPath::ZipEntry(_, name) => Ok(normalize(name)),
        _ => Err(failure("ZipDataVault received path with non-ZipEntryUPath")),
    }
}

impl ZipDataVault {
    pub fn new(outer: VaultPath) -> Self {
        Self {
            outer,
            directory: AlfuCache::new(
                1,
                Duration::from_secs(2 * 60 * 60),
                Duration::from_secs(60 * 60),
            ),
        }
    }
    async fn central(&self, token: Option<&str>) -> VaultResult<Arc<Directory>> {
        self.directory
            .get_or_load((), || async {
                self.load_directory(token)
                    .await
                    .map(Arc::new)
                    .map_err(DsError::from)
            })
            .await
            .map_err(|error| {
                if error == DsError::empty() {
                    VaultError::NotFound
                } else {
                    VaultError::Failure(error)
                }
            })
    }
    async fn load_directory(&self, token: Option<&str>) -> VaultResult<Directory> {
        let suffix = self.outer.read_last_bytes(SEARCH_BYTES, token).await?;
        let pos = suffix
            .len()
            .checked_sub(22)
            .and_then(|last| {
                (0..=last)
                    .rev()
                    .find(|&p| suffix[p..p + 4] == EOCD.to_le_bytes())
            })
            .ok_or_else(|| {
                failure("Could not find End of Central Directory (EOCD) record in zip file")
            })?;
        let count = u16_at(&suffix, pos + 10)?;
        let size = u32_at(&suffix, pos + 12)?;
        let offset = u32_at(&suffix, pos + 16)?;
        let (offset, size) = if count == u16::MAX || size == u32::MAX || offset == u32::MAX {
            let locator = pos.checked_sub(20).ok_or_else(|| {
                failure("ZIP64 EOCD locator not found in suffix buffer (too close to file start)")
            })?;
            let signature = u32_at(&suffix, locator)?;
            if signature != LOCATOR64 {
                return Err(failure(format!(
                    "Expected ZIP64 EOCD locator signature at offset {locator}, got 0x{signature:x}"
                )));
            }
            let start = u64_at(&suffix, locator + 8)?;
            let record = self
                .outer
                .read_bytes(
                    ByteRange::StartEnd {
                        start,
                        end: checked_add(start, 56)?,
                    },
                    token,
                )
                .await?;
            if record.len() < 56 {
                return Err(failure(format!(
                    "ZIP64 EOCD record too short: {} bytes",
                    record.len()
                )));
            }
            let signature = u32_at(&record, 0)?;
            if signature != EOCD64 {
                return Err(failure(format!(
                    "Expected ZIP64 EOCD signature 0x{EOCD64:x}, got 0x{signature:x}"
                )));
            }
            (u64_at(&record, 48)?, u64_at(&record, 40)?)
        } else {
            (u64::from(offset), u64::from(size))
        };
        if size > MAX_DIRECTORY_BYTES {
            return Err(failure("Zip central directory exceeds 128 MiB limit"));
        }
        let data = self
            .outer
            .read_bytes(
                ByteRange::StartEnd {
                    start: offset,
                    end: checked_add(offset, size)?,
                },
                token,
            )
            .await?;
        parse_directory(&data)
    }
}

fn parse_directory(data: &[u8]) -> VaultResult<Directory> {
    let mut entries = Vec::<Entry>::new();
    let mut by_name = HashMap::new();
    let mut pos = 0;
    while data.len().saturating_sub(pos) >= 46 {
        let signature = u32_at(data, pos)?;
        if signature != CENTRAL {
            return Err(failure(format!(
                "Expected zip central directory entry signature 0x{CENTRAL:x} at offset {pos}, got 0x{signature:x}"
            )));
        }
        let method = u16_at(data, pos + 10)?;
        let compressed = u64::from(u32_at(data, pos + 20)?);
        let size = u64::from(u32_at(data, pos + 24)?);
        let name_len = usize::from(u16_at(data, pos + 28)?);
        let extra_len = usize::from(u16_at(data, pos + 30)?);
        let comment_len = usize::from(u16_at(data, pos + 32)?);
        let offset = u64::from(u32_at(data, pos + 42)?);
        let name = String::from_utf8_lossy(bytes_at(data, pos + 46, name_len)?).into_owned();
        let extra = bytes_at(data, pos + 46 + name_len, extra_len)?;
        bytes_at(data, pos + 46 + name_len + extra_len, comment_len)?;
        let mut entry = Entry {
            offset,
            compressed,
            size,
            method,
            name: normalize(&name).into(),
        };
        extend_zip64(&mut entry, extra)?;
        if let Some(&index) = by_name.get(&entry.name) {
            entries[index] = entry;
        } else {
            if entries.len() == MAX_ENTRIES {
                return Err(failure("Zip central directory exceeds one million entries"));
            }
            by_name.insert(entry.name.clone(), entries.len());
            entries.push(entry);
        }
        pos += 46 + name_len + extra_len + comment_len;
    }
    let listing_order = scala_map_order(&entries);
    Ok(Directory {
        entries,
        by_name,
        listing_order,
    })
}

fn extend_zip64(entry: &mut Entry, extra: &[u8]) -> VaultResult<()> {
    let sentinel = u64::from(u32::MAX);
    if entry.offset != sentinel && entry.compressed != sentinel && entry.size != sentinel {
        return Ok(());
    }
    let mut pos = 0;
    while extra.len().saturating_sub(pos) >= 4 {
        let tag = u16_at(extra, pos)?;
        let count = usize::from(u16_at(extra, pos + 2)?);
        let field = bytes_at(extra, pos + 4, count)?;
        if tag == 1 {
            let mut p = 0;
            for (value, name) in [
                (&mut entry.size, "uncompressedSize"),
                (&mut entry.compressed, "compressedSize"),
                (&mut entry.offset, "localHeaderOffset"),
            ] {
                if *value == sentinel {
                    if field.len().saturating_sub(p) < 8 {
                        return Err(failure(format!(
                            "ZIP64 extra field truncated: missing {name}"
                        )));
                    }
                    *value = u64_at(field, p)?;
                    p += 8;
                }
            }
            return Ok(());
        }
        pos += 4 + count;
    }
    Err(failure(
        "ZIP64 extra field (tag 0x0001) not found in extra data field",
    ))
}

/// Scala Map1..4 retain insertion order. Larger maps iterate CHAMP payloads first, then children;
/// string hashes use UTF-16 Java hashCode and scala.collection.Hashing.improve.
fn scala_map_order(entries: &[Entry]) -> Vec<usize> {
    let mut indices: Vec<_> = (0..entries.len()).collect();
    if entries.len() <= 4 {
        return indices;
    }
    let hashes: Vec<u32> = entries
        .iter()
        .map(|e| {
            let h = e
                .name
                .encode_utf16()
                .fold(0u32, |h, c| h.wrapping_mul(31).wrapping_add(u32::from(c)));
            let h = h.wrapping_add(!(h << 9));
            let h = h ^ (h >> 14);
            let h = h.wrapping_add(h << 4);
            h ^ (h >> 10)
        })
        .collect();
    fn visit(indices: &[usize], hashes: &[u32], shift: u32, out: &mut Vec<usize>) {
        if indices.len() <= 1 || shift >= 32 {
            out.extend_from_slice(indices);
            return;
        }
        let mut groups: [Vec<usize>; 32] = std::array::from_fn(|_| Vec::new());
        for &i in indices {
            groups[((hashes[i] >> shift) & 31) as usize].push(i);
        }
        for group in &groups {
            if group.len() == 1 {
                out.push(group[0]);
            }
        }
        for group in &groups {
            if group.len() > 1 {
                visit(group, hashes, shift + 5, out);
            }
        }
    }
    let mut out = Vec::with_capacity(indices.len());
    visit(&indices, &hashes, 0, &mut out);
    indices.clear();
    out
}

impl DataVault for ZipDataVault {
    fn read_bytes_encoding_and_range_header<'a>(
        &'a self,
        path: &'a UPath,
        range: ByteRange,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<RawRead>> {
        Box::pin(async move {
            let name = inner(path)?;
            let directory = self.central(token).await?;
            let index = *directory.by_name.get(name).ok_or(VaultError::NotFound)?;
            let entry = &directory.entries[index];
            if entry.method != 0 {
                return Err(failure(format!(
                    "Only uncompressed zip entries are supported, but entry “{name}” uses compression method {}",
                    entry.method
                )));
            }
            let header = self
                .outer
                .read_bytes(
                    ByteRange::StartEnd {
                        start: entry.offset,
                        end: checked_add(entry.offset, 30)?,
                    },
                    token,
                )
                .await?;
            let data_start = checked_add(
                checked_add(entry.offset, 30)?,
                u64::from(u16_at(&header, 26)?) + u64::from(u16_at(&header, 28)?),
            )?;
            let (start, end) = match range {
                ByteRange::Complete => (0, entry.size),
                ByteRange::StartEnd { start, end } => (start.min(entry.size), end.min(entry.size)),
                ByteRange::Suffix { length } => (entry.size.saturating_sub(length), entry.size),
            };
            if end.saturating_sub(start) > MAX_READ_BYTES {
                return Err(failure("Zip entry read exceeds 300 MiB limit"));
            }
            let range = ByteRange::StartEnd { start, end };
            let raw = self
                .outer
                .read_bytes_encoding_and_range_header(
                    ByteRange::StartEnd {
                        start: checked_add(data_start, start)?,
                        end: checked_add(data_start, end)?,
                    },
                    token,
                )
                .await?;
            Ok(RawRead {
                bytes: raw.bytes,
                encoding: Encoding::Identity,
                content_range: range.to_content_range_header_with_length(entry.size),
            })
        })
    }
    fn list_directory<'a>(
        &'a self,
        path: &'a UPath,
        max: usize,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<Vec<UPath>>> {
        Box::pin(async move {
            let name = inner(path)?;
            let prefix = if name.is_empty() {
                String::new()
            } else {
                format!("{name}/")
            };
            let directory = self.central(token).await?;
            let mut paths = Vec::new();
            if max == 0 {
                return Ok(paths);
            }
            for &index in &directory.listing_order {
                let entry = &directory.entries[index];
                if let Some(rest) = entry.name.strip_prefix(&prefix)
                    && !rest.is_empty()
                    && !rest[..rest.len() - rest.chars().next_back().expect("nonempty").len_utf8()]
                        .contains('/')
                {
                    paths.push(UPath::ZipEntry(
                        Box::new(self.outer.upath().clone()),
                        entry.name.clone(),
                    ));
                    if paths.len() == max {
                        break;
                    }
                }
            }
            Ok(paths)
        })
    }
    fn used_storage_bytes<'a>(
        &'a self,
        path: &'a UPath,
        token: Option<&'a str>,
    ) -> BoxFuture<'a, VaultResult<u64>> {
        Box::pin(async move {
            let name = inner(path)?;
            let prefix = if name.is_empty() {
                String::new()
            } else {
                format!("{name}/")
            };
            let directory = self.central(token).await?;
            directory
                .entries
                .iter()
                .filter(|e| e.name == name || e.name.starts_with(&prefix))
                .try_fold(0u64, |sum, e| checked_add(sum, e.compressed))
        })
    }
    fn kind(&self) -> &'static str {
        "ZipDataVault"
    }
}
