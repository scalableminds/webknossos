//! Scala `TileCsvParser`: validates the tile CSV of an alignment project and extracts its section
//! range. Each row is `section,x,y,path`, with the path relative to the CSV, e.g.
//! `5,0,240,./005_000_001_000_n_00.tif`. Additional columns after the path are ignored. An optional
//! header row (starting with `section`) is skipped. Section numbers must be continuous (every
//! number between the first and last section must occur), but may start at any value. Whether the
//! referenced files exist is not checked.
use std::{
    collections::HashSet,
    io::{BufRead, BufReader},
    path::Path,
};

use crate::{
    error::{DsError, DsResult},
    services::upload::stays_inside,
};

const MIN_COLUMN_COUNT: usize = 4;
const HEADER_FIRST_CELL: &str = "section";

/// Msg.AlignmentProject.Csv.
pub mod msg {
    pub const NOT_FOUND: &str = "No CSV file was found among the uploaded files.";
    pub fn multiple_found(paths: &[String]) -> String {
        format!(
            "Expected exactly one CSV file, found {}: {}.",
            paths.len(),
            paths.join(", ")
        )
    }
    pub const UNREADABLE: &str = "The CSV file could not be read.";
    pub const NOT_ATTACHED: &str = "No CSV file was attached.";
    pub const INVALID_CURRENT_PATH: &str = "Invalid path of the current CSV.";
    pub const STORE_FAILED: &str = "Could not store the new CSV file.";
    pub const NO_TILES: &str = "The CSV file contains no tiles.";
    pub fn sections_not_continuous(missing: i32, first: i32, last: i32) -> String {
        format!(
            "Section numbers are not continuous: section {missing} is missing between {first} and {last}."
        )
    }
    pub fn invalid_row(row_number: usize, problem: &str) -> String {
        format!("Row {row_number}: {problem}")
    }
    // The following describe the problem of a single row, see `invalid_row`.
    pub fn section_not_integer(section: &str) -> String {
        format!("section number \"{section}\" is not an integer.")
    }
    pub fn position_not_numeric(x: &str, y: &str) -> String {
        format!("position \"{x},{y}\" is not numeric.")
    }
    pub const EMPTY_PATH: &str = "the path is empty.";
    pub fn path_not_relative(path: &str) -> String {
        format!("path \"{path}\" must be relative to the CSV file.")
    }
    pub fn too_few_columns(min_column_count: usize, found: usize) -> String {
        format!("expected at least {min_column_count} columns (section,x,y,path), found {found}.")
    }
}

/// Scala `SectionRange`: inclusive on both ends, so it contains `last - first + 1` sections.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct SectionRange {
    pub first: i32,
    pub last: i32,
}

/// Reads the file line by line, so that large CSVs are not loaded into memory at once.
pub fn parse_section_range_file(csv_file: &Path) -> DsResult<SectionRange> {
    let file = std::fs::File::open(csv_file).map_err(DsError::from_exception)?;
    parse_section_range_reader(BufReader::new(file))
}

/// Like [`parse_section_range_file`] for any reader (decoded as UTF-8, failing on malformed
/// input like Scala's `Source.fromFile`).
pub fn parse_section_range_reader(reader: impl BufRead) -> DsResult<SectionRange> {
    let mut error = None;
    let lines = JavaLines {
        reader,
        pending: Vec::new(),
        error: &mut error,
    };
    let result = parse_section_range(lines);
    match error {
        Some(e) => Err(e),
        None => result,
    }
}

/// Scala `parseSectionRange(lines)`.
pub fn parse_section_range(lines: impl Iterator<Item = String>) -> DsResult<SectionRange> {
    let mut rows = lines
        .enumerate()
        .map(|(index, line)| {
            let line = line
                .strip_prefix('\u{FEFF}')
                .map(str::to_owned)
                .unwrap_or(line);
            (line, index + 1)
        })
        .filter(|(line, _)| !java_trim(line).is_empty())
        .map(|(line, row_number)| (split_row(&line), row_number))
        .peekable();
    if rows.peek().is_some_and(|(cells, _)| {
        cells
            .first()
            .is_some_and(|cell| java_equals_ignore_case(cell, HEADER_FIRST_CELL))
    }) {
        rows.next();
    }
    let mut sections = HashSet::new();
    for (cells, row_number) in rows {
        match parse_row(&cells) {
            Ok(section) => {
                sections.insert(section);
            }
            Err(message) => return Err(DsError::failure(msg::invalid_row(row_number, &message))),
        }
    }
    let (Some(&first), Some(&last)) = (sections.iter().min(), sections.iter().max()) else {
        return Err(DsError::failure(msg::NO_TILES));
    };
    match (first..=last).find(|section| !sections.contains(section)) {
        Some(missing) => Err(DsError::failure(msg::sections_not_continuous(
            missing, first, last,
        ))),
        None => Ok(SectionRange { first, last }),
    }
}

/// Returns the section number of a valid row.
fn parse_row(cells: &[String]) -> Result<i32, String> {
    let [section, x, y, path, ..] = cells else {
        return Err(msg::too_few_columns(MIN_COLUMN_COUNT, cells.len()));
    };
    let section_number = section
        .parse::<i32>()
        .map_err(|_| msg::section_not_integer(section))?;
    if !is_java_double(x) || !is_java_double(y) {
        return Err(msg::position_not_numeric(x, y));
    }
    if path.is_empty() {
        return Err(msg::EMPTY_PATH.to_owned());
    }
    if !is_within_csv_directory(path) {
        return Err(msg::path_not_relative(path));
    }
    Ok(section_number)
}

/// Rejects absolute paths and paths escaping the CSV's directory, since the worker resolves them
/// on the datastore (Java `Paths.get(path).normalize()`: not absolute, not starting with `..`;
/// an unparsable path, i.e. one containing NUL, is rejected too).
fn is_within_csv_directory(path: &str) -> bool {
    !path.contains('\0') && stays_inside(path)
}

/// E.g. `tiles.csv` → `tiles.v2.csv` → `tiles.v3.csv`. Without a current CSV, the uploaded file
/// name is the base.
pub fn next_csv_file_name(
    current_file_name: Option<&str>,
    uploaded_file_name: &str,
    is_taken: impl Fn(&str) -> bool,
) -> String {
    let base_name = match current_file_name {
        Some(name) => name.to_owned(),
        None => uploaded_file_name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') {
                    c
                } else {
                    '_'
                }
            })
            .collect(),
    };
    let base_name = strip_suffix_ignore_ascii_case(&base_name, ".csv");
    let base_name = strip_version_suffix(base_name);
    let safe_base_name = if base_name.is_empty() || base_name.starts_with('.') {
        "tiles"
    } else {
        base_name
    };
    std::iter::once(format!("{safe_base_name}.csv"))
        .chain((2..).map(|version| format!("{safe_base_name}.v{version}.csv")))
        .find(|name| !is_taken(name))
        .unwrap_or_else(|| format!("{safe_base_name}.csv"))
}

/// `replaceAll("(?i)\\.csv$", "")`.
fn strip_suffix_ignore_ascii_case<'a>(name: &'a str, suffix: &str) -> &'a str {
    let split = name.len().saturating_sub(suffix.len());
    match (name.get(..split), name.get(split..)) {
        (Some(head), Some(tail)) if tail.eq_ignore_ascii_case(suffix) => head,
        _ => name,
    }
}

/// `replaceAll("\\.v\\d+$", "")` (Java `\d` is ASCII-only).
fn strip_version_suffix(name: &str) -> &str {
    let without_digits = name.trim_end_matches(|c: char| c.is_ascii_digit());
    if without_digits.len() < name.len()
        && let Some(head) = without_digits.strip_suffix(".v")
    {
        return head;
    }
    name
}

/// Scala `line.split(",", -1).map(_.trim.stripPrefix("\"").stripSuffix("\"").trim)`.
fn split_row(line: &str) -> Vec<String> {
    line.split(',')
        .map(|cell| {
            let cell = java_trim(cell);
            let cell = cell.strip_prefix('"').unwrap_or(cell);
            let cell = cell.strip_suffix('"').unwrap_or(cell);
            java_trim(cell).to_owned()
        })
        .collect()
}

/// Java `String.trim`: strips characters up to U+0020 on both ends.
fn java_trim(value: &str) -> &str {
    value.trim_matches(|c: char| c <= ' ')
}

/// Java `String.equalsIgnoreCase` (per character: equal, equal upper case or equal lower case of
/// the upper case).
fn java_equals_ignore_case(a: &str, b: &str) -> bool {
    fn single(mut chars: impl Iterator<Item = char>, fallback: char) -> char {
        match (chars.next(), chars.next()) {
            (Some(c), None) => c,
            _ => fallback,
        }
    }
    let upper = |c: char| single(c.to_uppercase(), c);
    let lower = |c: char| single(c.to_lowercase(), c);
    a.chars().count() == b.chars().count()
        && a.chars()
            .zip(b.chars())
            .all(|(x, y)| x == y || upper(x) == upper(y) || lower(upper(x)) == lower(upper(y)))
}

/// Scala `toDoubleOption` (Java `Double.parseDouble` syntax): optional sign, `NaN`, `Infinity`,
/// decimal or hexadecimal floating-point literals with an optional `f`/`F`/`d`/`D` suffix.
fn is_java_double(value: &str) -> bool {
    let value = java_trim(value);
    let unsigned = value
        .strip_prefix('-')
        .or_else(|| value.strip_prefix('+'))
        .unwrap_or(value);
    if unsigned == "NaN" || unsigned == "Infinity" {
        return true;
    }
    let unsuffixed = unsigned
        .strip_suffix(['f', 'F', 'd', 'D'])
        .unwrap_or(unsigned);
    if let Some(hex) = unsuffixed
        .strip_prefix("0x")
        .or_else(|| unsuffixed.strip_prefix("0X"))
    {
        return is_hex_float(hex);
    }
    is_decimal_float(unsuffixed)
}

fn digits_then(value: &str, is_digit: impl Fn(char) -> bool) -> (usize, &str) {
    let rest = value.trim_start_matches(is_digit);
    (value.len() - rest.len(), rest)
}

/// `[sign] digits` after an exponent marker.
fn is_exponent(value: &str) -> bool {
    let unsigned = value
        .strip_prefix('-')
        .or_else(|| value.strip_prefix('+'))
        .unwrap_or(value);
    !unsigned.is_empty() && unsigned.chars().all(|c| c.is_ascii_digit())
}

/// `digits[.digits]`, `.digits` or `digits.`, then an optional `e`/`E` exponent.
fn is_decimal_float(value: &str) -> bool {
    let (integer_digits, rest) = digits_then(value, |c| c.is_ascii_digit());
    let (fraction_digits, rest) = match rest.strip_prefix('.') {
        Some(fraction) => digits_then(fraction, |c| c.is_ascii_digit()),
        None => (0, rest),
    };
    if integer_digits + fraction_digits == 0 {
        return false;
    }
    match rest.strip_prefix(['e', 'E']) {
        Some(exponent) => is_exponent(exponent),
        None => rest.is_empty(),
    }
}

/// Hexadecimal significand (`h`, `h.`, `h.h` or `.h`) followed by a mandatory `p`/`P` exponent.
fn is_hex_float(value: &str) -> bool {
    let (integer_digits, rest) = digits_then(value, |c| c.is_ascii_hexdigit());
    let (fraction_digits, rest) = match rest.strip_prefix('.') {
        Some(fraction) => digits_then(fraction, |c| c.is_ascii_hexdigit()),
        None => (0, rest),
    };
    integer_digits + fraction_digits > 0 && rest.strip_prefix(['p', 'P']).is_some_and(is_exponent)
}

/// Lines like Java's `BufferedReader.readLine` (`\n`, `\r\n` and a lone `\r` end a line), decoded
/// as UTF-8. A read or decoding failure ends the iteration and is stored in `error`.
struct JavaLines<'a, R> {
    reader: R,
    pending: Vec<String>,
    error: &'a mut Option<DsError>,
}

impl<R: BufRead> Iterator for JavaLines<'_, R> {
    type Item = String;

    fn next(&mut self) -> Option<String> {
        if let Some(line) = self.pending.pop() {
            return Some(line);
        }
        if self.error.is_some() {
            return None;
        }
        let mut buffer = Vec::new();
        match self.reader.read_until(b'\n', &mut buffer) {
            Ok(0) => return None,
            Ok(_) => {}
            Err(e) => {
                *self.error = Some(DsError::from_exception(e));
                return None;
            }
        }
        if buffer.last() == Some(&b'\n') {
            buffer.pop();
        }
        // `\r\n` (or a final lone `\r`) terminates the line.
        if buffer.last() == Some(&b'\r') {
            buffer.pop();
        }
        let Ok(text) = String::from_utf8(buffer) else {
            *self.error = Some(DsError::failure(msg::UNREADABLE));
            return None;
        };
        // Remaining lone `\r`s separate further lines.
        self.pending = text.split('\r').rev().map(str::to_owned).collect();
        self.pending.pop()
    }
}

#[cfg(test)]
mod services_tile_csv_tests;
