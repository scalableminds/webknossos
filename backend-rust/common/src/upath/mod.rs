//! Scala `helpers/UPath.scala`: local, remote and zip-entry paths with Scala's string semantics,
//! as they appear in `datasource-properties.json` (`mags[].path`, attachment `path`) and as used by
//! the data vaults. The datastore's `datavault` adds `to_remote_uri` (see `datavault/uri`).
//!
//! Equality: Scala compares `toString`; the structural equality derived here is equivalent
//! because every variant's string form determines its fields.

use std::{
    fmt,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::json::{JsError, JsResult};

const SCHEME_SEPARATOR: &str = "://";
/// Scala `ZipEntryUPath.separatorWithPath`.
pub const ZIP_SEPARATOR_WITH_PATH: &str = "|zip:";
/// Scala `ZipEntryUPath.separatorRootOnly`.
pub const ZIP_SEPARATOR_ROOT_ONLY: &str = "|zip";
/// Scala `ZipEntryUPath.relevantFileExtensions`.
pub const ZIP_RELEVANT_FILE_EXTENSIONS: &[&str] = &[".zip", ".ozx"];
/// Scala `PathSchemes.schemeFile`.
pub const SCHEME_FILE: &str = "file";

/// A failed `UPath` operation: Scala's failure message plus, for thrown exceptions, the
/// exception's `toString` (Scala `Failure(msg, Full(e), Empty)`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UPathError {
    pub message: String,
    pub exception: Option<String>,
}

impl UPathError {
    fn failure(message: String) -> Self {
        Self {
            message,
            exception: None,
        }
    }
}

impl fmt::Display for UPathError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for UPathError {}

/// A failed `UPath.fromStringUnsafe`: the message plus the `toString` of the thrown exception,
/// like Scala `tryo` (`Failure(e.getMessage, Full(e), Empty)`).
fn parse_failure(exception_class: &str, message: String) -> UPathError {
    UPathError {
        exception: Some(format!("{exception_class}: {message}")),
        message,
    }
}

fn exception(message: String) -> UPathError {
    parse_failure("java.lang.Exception", message)
}

/// A lexically normalized local path (Scala `LocalUPath` around a normalized `java.nio.file.Path`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct LocalPath {
    absolute: bool,
    parts: Vec<String>,
}

impl LocalPath {
    /// `Path.of(literal).normalize()` (unix semantics: redundant and trailing slashes vanish).
    pub fn parse(literal: &str) -> Self {
        Self::raw(literal).normalize()
    }

    fn raw(literal: &str) -> Self {
        Self {
            absolute: literal.starts_with('/'),
            parts: literal
                .split('/')
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
        }
    }

    pub fn from_path(path: &Path) -> Self {
        Self::parse(&path.to_string_lossy())
    }

    /// Java `Path.normalize`: drops `.`, resolves `name/..`; `..` directly below the root vanishes.
    fn normalize(self) -> Self {
        let mut parts: Vec<String> = Vec::with_capacity(self.parts.len());
        for part in self.parts {
            match part.as_str() {
                "." => {}
                ".." => match parts.last() {
                    Some(last) if last != ".." => {
                        parts.pop();
                    }
                    _ if self.absolute => {}
                    _ => parts.push(part),
                },
                _ => parts.push(part),
            }
        }
        Self {
            absolute: self.absolute,
            parts,
        }
    }

    pub fn is_absolute(&self) -> bool {
        self.absolute
    }

    /// The name elements (Java `Path` name components).
    pub fn parts(&self) -> &[String] {
        &self.parts
    }

    /// Java `Path.resolve(other)` followed by `normalize`.
    fn resolve(&self, other: &str) -> Self {
        let other = Self::raw(other);
        if other.absolute {
            return other.normalize();
        }
        let mut parts = self.parts.clone();
        parts.extend(other.parts);
        Self {
            absolute: self.absolute,
            parts,
        }
        .normalize()
    }

    /// Java `toAbsolutePath().normalize()` against `cwd`.
    fn to_absolute_in(&self, cwd: &LocalPath) -> Self {
        if self.absolute {
            return self.clone();
        }
        let mut parts = cwd.parts.clone();
        parts.extend(self.parts.iter().cloned());
        Self {
            absolute: true,
            parts,
        }
        .normalize()
    }

    /// Java `toAbsolutePath().normalize()` against the process working directory.
    fn to_absolute(&self) -> Self {
        if self.absolute {
            return self.clone();
        }
        self.to_absolute_in(&process_cwd())
    }

    fn starts_with(&self, other: &LocalPath) -> bool {
        self.absolute == other.absolute && self.parts.starts_with(&other.parts)
    }

    pub fn to_path_buf(&self) -> PathBuf {
        PathBuf::from(self.to_string())
    }
}

fn process_cwd() -> LocalPath {
    std::env::current_dir()
        .map(|p| LocalPath::from_path(&p))
        .unwrap_or(LocalPath {
            absolute: true,
            parts: Vec::new(),
        })
}

/// Java `Path.toString` (no `./` prefix; the empty path is the empty string).
impl fmt::Display for LocalPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.absolute {
            f.write_str("/")?;
        }
        f.write_str(&self.parts.join("/"))
    }
}

/// Scala `RemoteUPath(scheme, segments)`; `segments[0]` is the authority.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RemotePath {
    scheme: String,
    segments: Vec<String>,
}

impl RemotePath {
    fn new(scheme: String, segments: Vec<String>) -> Self {
        Self { scheme, segments }.normalize()
    }

    /// Scala `normalize`: drops `.`, `..` pops a segment but never the authority.
    fn normalize(self) -> Self {
        let mut collected: Vec<String> = Vec::with_capacity(self.segments.len());
        for segment in self.segments {
            match segment.as_str() {
                "." => {}
                ".." => {
                    if collected.len() >= 2 {
                        collected.pop();
                    }
                }
                _ => collected.push(segment),
            }
        }
        Self {
            scheme: self.scheme,
            segments: collected,
        }
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    pub fn segments(&self) -> &[String] {
        &self.segments
    }

    fn join(&self, other: &str) -> Self {
        let mut segments = self.segments.clone();
        if segments.last().is_some_and(String::is_empty) {
            segments.pop();
        }
        segments.extend(other.split('/').map(str::to_owned));
        Self::new(self.scheme.clone(), segments)
    }

    fn starts_with(&self, other: &RemotePath) -> bool {
        let mut other_segments = other.segments.as_slice();
        if other_segments.last().is_some_and(String::is_empty) {
            other_segments = &other_segments[..other_segments.len() - 1];
        }
        self.scheme == other.scheme && self.segments.starts_with(other_segments)
    }
}

impl fmt::Display for RemotePath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}{SCHEME_SEPARATOR}{}",
            self.scheme,
            self.segments.join("/")
        )
    }
}

/// Scala `UPath`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum UPath {
    Local(LocalPath),
    Remote(RemotePath),
    /// Scala `ZipEntryUPath(outerPath, innerPath)`: `<outer>|zip:<inner>` or `<outer>|zip`.
    ZipEntry(Box<UPath>, String),
}

impl UPath {
    /// Scala `UPath.fromString` (failure messages and exceptions as the thrown ones').
    pub fn parse(literal: &str) -> Result<Self, UPathError> {
        if let Some((outer, inner)) = detect_and_split_zip_entry_path(literal)? {
            return Ok(Self::ZipEntry(Box::new(Self::parse(outer)?), inner));
        }
        // `UnixPath.checkNotNul` in `Path.of`.
        if literal.contains('\0') {
            return Err(parse_failure(
                "java.nio.file.InvalidPathException",
                format!("Nul character not allowed: {literal}"),
            ));
        }
        let scheme = if literal.contains(SCHEME_SEPARATOR) {
            // Java `split` drops trailing empty strings; an all-empty split has no head.
            let parts: Vec<&str> = literal.split(SCHEME_SEPARATOR).collect();
            if parts.iter().all(|p| p.is_empty()) {
                None
            } else {
                Some(parts[0])
            }
        } else {
            None
        };
        match scheme {
            None => Ok(Self::Local(LocalPath::parse(literal))),
            Some(scheme) => {
                let rest = &literal[scheme.len() + SCHEME_SEPARATOR.len()..];
                if scheme.contains(SCHEME_FILE) {
                    let path = LocalPath::parse(rest);
                    if !path.is_absolute() {
                        return Err(exception(format!(
                            "Trying to construct relative UPath {path}. Must either be absolute or have no scheme."
                        )));
                    }
                    Ok(Self::Local(path))
                } else {
                    Ok(Self::Remote(RemotePath::new(
                        scheme.to_owned(),
                        rest.split('/').map(str::to_owned).collect(),
                    )))
                }
            }
        }
    }

    /// Scala `UPath.fromLocalPath`.
    pub fn from_local_path(path: &Path) -> Self {
        Self::Local(LocalPath::from_path(path))
    }

    /// Scala `/(String)`.
    pub fn join(&self, other: &str) -> Self {
        match self {
            Self::Local(path) => Self::Local(path.resolve(other)),
            Self::Remote(path) => Self::Remote(path.join(other)),
            Self::ZipEntry(outer, inner) => {
                let combined = collapse_slashes(&format!("{inner}/{other}"));
                let combined = combined.strip_prefix('/').unwrap_or(&combined).to_owned();
                Self::ZipEntry(outer.clone(), combined)
            }
        }
    }

    /// Scala `/(UPath)`.
    pub fn join_upath(&self, other: &UPath) -> Self {
        match other {
            Self::ZipEntry(outer, inner) => {
                Self::ZipEntry(Box::new(self.join_upath(outer)), inner.clone())
            }
            _ => self.join(&other.to_string()),
        }
    }

    pub fn is_absolute(&self) -> bool {
        match self {
            Self::Local(path) => path.is_absolute(),
            Self::Remote(_) => true,
            Self::ZipEntry(outer, _) => outer.is_absolute(),
        }
    }

    pub fn is_relative(&self) -> bool {
        !self.is_absolute()
    }

    pub fn is_remote(&self) -> bool {
        match self {
            Self::Local(_) => false,
            Self::Remote(_) => true,
            Self::ZipEntry(outer, _) => outer.is_remote(),
        }
    }

    pub fn is_local(&self) -> bool {
        !self.is_remote()
    }

    /// Scala `getScheme`.
    pub fn scheme(&self) -> Option<&str> {
        match self {
            Self::Local(_) => None,
            Self::Remote(path) => Some(&path.scheme),
            Self::ZipEntry(outer, _) => outer.scheme(),
        }
    }

    /// Scala `toLocalPath`.
    pub fn to_local_path(&self) -> Result<PathBuf, UPathError> {
        match self {
            Self::Local(path) => Ok(path.to_path_buf()),
            Self::Remote(_) => Err(UPathError::failure(format!(
                "Accessed toLocalPath on RemotePath {self}"
            ))),
            Self::ZipEntry(..) => Err(UPathError::failure(format!(
                "ZipEntryUPath cannot be accessed as a local path: {self}"
            ))),
        }
    }

    /// Scala `toZipEntryUPath`: `(outer, inner)` of a zip entry path.
    pub fn to_zip_entry(&self) -> Result<(&UPath, &str), UPathError> {
        match self {
            Self::ZipEntry(outer, inner) => Ok((outer, inner)),
            Self::Local(_) => Err(UPathError::failure(format!(
                "Called toZipEntryUPath on LocalUPath {self}"
            ))),
            Self::Remote(_) => Err(UPathError::failure(format!(
                "Called toZipEntryUPath on RemotePath {self}"
            ))),
        }
    }

    /// Scala `toAbsolute` (relative local paths resolve against the working directory).
    pub fn to_absolute(&self) -> Self {
        match self {
            Self::Local(path) => Self::Local(path.to_absolute()),
            Self::Remote(_) => self.clone(),
            Self::ZipEntry(outer, inner) => {
                Self::ZipEntry(Box::new(outer.to_absolute()), inner.clone())
            }
        }
    }

    /// Scala `toReal` (`toRealPath`, resolving symlinks; the path must exist).
    pub fn to_real(&self) -> Result<Self, UPathError> {
        match self {
            Self::Local(path) => std::fs::canonicalize(path.to_path_buf())
                .map(|p| Self::from_local_path(&p))
                .map_err(|e| {
                    let text = e.to_string();
                    UPathError {
                        exception: Some(text.clone()),
                        message: text,
                    }
                }),
            Self::Remote(_) => Ok(self.clone()),
            Self::ZipEntry(outer, inner) => {
                Ok(Self::ZipEntry(Box::new(outer.to_real()?), inner.clone()))
            }
        }
    }

    /// Scala `resolvedIn`: relative paths are appended to `parent_if_relative`.
    pub fn resolved_in(&self, parent_if_relative: &UPath) -> Self {
        if self.is_relative() {
            parent_if_relative.join_upath(self)
        } else {
            self.clone()
        }
    }

    /// Scala `relativizedIn`: a local path below `potential_ancestor` becomes relative to it
    /// (relative paths are made absolute against the process working directory first).
    pub fn relativized_in(&self, potential_ancestor: &UPath) -> Self {
        self.relativized_in_cwd(potential_ancestor, &process_cwd())
    }

    /// [`Self::relativized_in`] with an explicit working directory (must be absolute).
    pub fn relativized_in_cwd(&self, potential_ancestor: &UPath, cwd: &LocalPath) -> Self {
        match (self, potential_ancestor) {
            (Self::Local(path), Self::Local(ancestor)) => {
                let path = path.to_absolute_in(cwd);
                let ancestor = ancestor.to_absolute_in(cwd);
                if path.starts_with(&ancestor) {
                    Self::Local(LocalPath {
                        absolute: false,
                        parts: path.parts[ancestor.parts.len()..].to_vec(),
                    })
                } else {
                    self.clone()
                }
            }
            (Self::ZipEntry(outer, inner), _) => Self::ZipEntry(
                Box::new(outer.relativized_in_cwd(potential_ancestor, cwd)),
                inner.clone(),
            ),
            _ => self.clone(),
        }
    }

    pub fn basename(&self) -> String {
        match self {
            Self::Local(path) => path.parts.last().cloned().unwrap_or_default(),
            Self::Remote(path) => path
                .segments
                .iter()
                .rev()
                .find(|s| !s.is_empty())
                .cloned()
                .unwrap_or_default(),
            Self::ZipEntry(_, inner) => inner
                .split('/')
                .rfind(|s| !s.is_empty())
                .unwrap_or("")
                .to_owned(),
        }
    }

    pub fn parent(&self) -> Self {
        match self {
            Self::Local(path) => {
                // Java `getParent` is null for a root, the empty path or a single relative name.
                if path.parts.is_empty() || (!path.absolute && path.parts.len() == 1) {
                    self.clone()
                } else {
                    Self::Local(LocalPath {
                        absolute: path.absolute,
                        parts: path.parts[..path.parts.len() - 1].to_vec(),
                    })
                }
            }
            Self::Remote(path) => {
                if path.segments.len() < 2 {
                    self.clone()
                } else {
                    Self::Remote(RemotePath {
                        scheme: path.scheme.clone(),
                        segments: path.segments[..path.segments.len() - 1].to_vec(),
                    })
                }
            }
            Self::ZipEntry(outer, inner) => {
                let parts: Vec<&str> = inner.split('/').filter(|s| !s.is_empty()).collect();
                let parent = parts[..parts.len().saturating_sub(1)].join("/");
                Self::ZipEntry(outer.clone(), parent)
            }
        }
    }

    pub fn starts_with(&self, other: &UPath) -> bool {
        match (self, other) {
            (Self::ZipEntry(outer, inner), Self::ZipEntry(other_outer, other_inner)) => {
                outer == other_outer
                    && (other_inner.is_empty()
                        || inner == other_inner
                        || inner.starts_with(&format!("{other_inner}/")))
            }
            (Self::ZipEntry(outer, _), _) => outer.starts_with(other),
            (Self::Local(path), Self::Local(other)) => {
                path.to_absolute().starts_with(&other.to_absolute())
            }
            (Self::Remote(path), Self::Remote(other)) => path.starts_with(other),
            _ => false,
        }
    }

    /// Play reads (`UPath.jsonFormat`): a string; parse failures become
    /// `Invalid UPath: Failure(<msg>,Full(<exception>),Empty)`.
    pub fn from_json(json: &Value) -> JsResult<Self> {
        match json {
            Value::String(s) => Self::parse(s).map_err(|e| JsError::new(invalid_upath_message(&e))),
            _ => Err(JsError::new("error.expected.jsstring")),
        }
    }
}

/// Scala `f"Invalid UPath: $f"` for the `tryo` failure (case-class `toString` of `Failure`).
fn invalid_upath_message(error: &UPathError) -> String {
    let exception = error
        .exception
        .as_ref()
        .map_or_else(|| "Empty".to_owned(), |e| format!("Full({e})"));
    format!(
        "Invalid UPath: Failure({},{exception},Empty)",
        error.message
    )
}

impl fmt::Display for UPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Local(path) => {
                if !path.absolute {
                    f.write_str("./")?;
                }
                path.fmt(f)
            }
            Self::Remote(path) => path.fmt(f),
            Self::ZipEntry(outer, inner) => {
                if inner.is_empty() {
                    write!(f, "{outer}{ZIP_SEPARATOR_ROOT_ONLY}")
                } else {
                    write!(f, "{outer}{ZIP_SEPARATOR_WITH_PATH}{inner}")
                }
            }
        }
    }
}

impl std::str::FromStr for UPath {
    type Err = UPathError;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Self::parse(s)
    }
}

/// Scala `UPath.jsonFormat` writes: a JSON string.
impl Serialize for UPath {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for UPath {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        Self::from_json(&value).map_err(serde::de::Error::custom)
    }
}

/// Java `replaceAll("//+", "/")`.
fn collapse_slashes(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut previous_slash = false;
    for c in value.chars() {
        if c == '/' {
            if !previous_slash {
                out.push(c);
            }
            previous_slash = true;
        } else {
            out.push(c);
            previous_slash = false;
        }
    }
    out
}

/// Scala `detectAndSplitZipEntryPath` + `splitZipLiteralUnsafe`.
fn detect_and_split_zip_entry_path(literal: &str) -> Result<Option<(&str, String)>, UPathError> {
    let with_path_idx = literal.find(ZIP_SEPARATOR_WITH_PATH);
    let is_root_reference = with_path_idx.is_none() && literal.ends_with(ZIP_SEPARATOR_ROOT_ONLY);
    if with_path_idx.is_none() && !is_root_reference {
        return Ok(None);
    }
    if literal.find(ZIP_SEPARATOR_ROOT_ONLY) != literal.rfind(ZIP_SEPARATOR_ROOT_ONLY) {
        return Err(exception(format!(
            "Invalid zip path “{literal}”: Nested zip paths are not supported."
        )));
    }
    let (outer, inner) = match with_path_idx {
        Some(idx) => (
            &literal[..idx],
            &literal[idx + ZIP_SEPARATOR_WITH_PATH.len()..],
        ),
        None => (
            &literal[..literal.len() - ZIP_SEPARATOR_ROOT_ONLY.len()],
            "",
        ),
    };
    if outer.is_empty() {
        return Err(exception(format!(
            "Invalid zip path “{literal}”: Outer path must not be empty."
        )));
    }
    if inner.starts_with("//") {
        return Err(exception(format!(
            "Invalid zip path “{literal}”: Multiple leading slashes for inner path are not allowed."
        )));
    }
    Ok(Some((
        outer,
        inner.strip_prefix('/').unwrap_or(inner).to_owned(),
    )))
}

#[cfg(test)]
mod tests;
