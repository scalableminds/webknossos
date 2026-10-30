//! File responses and zip assembly.
use std::io::{Cursor, Write};

use axum::{
    body::Body,
    http::{HeaderValue, header},
    response::{IntoResponse, Response},
};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::error::ApiError;

pub(super) fn file_response(
    bytes: Vec<u8>,
    mime_type: &'static str,
    disposition: String,
) -> Response {
    let mut response = Response::new(Body::from(bytes));
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_type));
    match HeaderValue::from_str(&disposition) {
        Ok(value) => {
            headers.insert(header::CONTENT_DISPOSITION, value);
        }
        Err(_) => return ApiError::internal().into_response(),
    }
    response
}

pub(super) struct ZipEntry<'a> {
    pub(super) name: String,
    pub(super) bytes: &'a [u8],
    /// Deflater.BEST_SPEED (level 1) instead of the default level.
    pub(super) fast: bool,
}

/// ZipIO: DEFLATED entries in order (default level unless `fast`).
pub(super) fn zip_entries(entries: &[ZipEntry<'_>]) -> Result<Vec<u8>, zip::result::ZipError> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for entry in entries {
        add_entry(
            &mut writer,
            &entry.name,
            entry.bytes,
            entry.fast.then_some(1),
        )?;
    }
    Ok(writer.finish()?.into_inner())
}

/// One DEFLATED entry at the default level.
pub(super) fn add_zip_entry(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    bytes: &[u8],
) -> Result<(), zip::result::ZipError> {
    add_entry(writer, name, bytes, None)
}

fn add_entry(
    writer: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    bytes: &[u8],
    level: Option<i64>,
) -> Result<(), zip::result::ZipError> {
    let options = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(level)
        .large_file(bytes.len() as u64 >= u64::from(u32::MAX));
    writer.start_file(name, options)?;
    writer.write_all(bytes)?;
    Ok(())
}
