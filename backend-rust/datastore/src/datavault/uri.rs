//! The subset of `java.net.URI` parsing that the vaults rely on (`getScheme`, `getAuthority`,
//! `getHost`, `getPort`, `getPath` (decoded), `getRawPath`). Strings that `new URI(..)` rejects
//! (spaces, `<>"{}|\^` and backticks, control characters, malformed `%` escapes) are rejected with
//! a `URISyntaxException`-style message.

use std::fmt;

use percent_encoding::percent_decode_str;

use crate::{error::DsError, models::upath::UPath};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RemoteUri {
    original: String,
    scheme: String,
    authority: Option<String>,
    host: Option<String>,
    port: Option<u16>,
    raw_path: String,
    query: Option<String>,
}

impl RemoteUri {
    pub fn parse(input: &str) -> Result<Self, String> {
        let syntax = |what: &str, index: usize| format!("{what} at index {index}: {input}");
        let colon = input
            .find([':', '/', '?', '#'])
            .filter(|&i| input.as_bytes()[i] == b':')
            .ok_or_else(|| syntax("Expected scheme name", 0))?;
        if colon == 0 {
            return Err(syntax("Expected scheme name", 0));
        }
        let scheme = &input[..colon];
        for (i, c) in scheme.char_indices() {
            let valid = if i == 0 {
                c.is_ascii_alphabetic()
            } else {
                c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')
            };
            if !valid {
                return Err(syntax("Illegal character in scheme name", i));
            }
        }
        let rest_start = colon + 1;
        let rest = &input[rest_start..];
        let (fragment_split, _) = split_once_keep(rest, '#');
        let (before_query, query) = split_once_keep(fragment_split, '?');
        let (authority, raw_path, path_start) = if let Some(after) = before_query.strip_prefix("//")
        {
            let end = after.find('/').unwrap_or(after.len());
            (Some(&after[..end]), &after[end..], rest_start + 2 + end)
        } else {
            (None, before_query, rest_start)
        };
        if let Some(authority) = authority {
            check_chars(authority, rest_start + 2, input, Component::Authority)?;
        }
        check_chars(raw_path, path_start, input, Component::Path)?;
        if let Some(query) = query {
            let query_start = path_start + raw_path.len() + 1;
            check_chars(query, query_start, input, Component::Query)?;
        }
        let (host, port) = authority
            .map(parse_server_authority)
            .unwrap_or((None, None));
        Ok(Self {
            original: input.to_owned(),
            scheme: scheme.to_owned(),
            authority: authority.filter(|a| !a.is_empty()).map(str::to_owned),
            host,
            port,
            raw_path: raw_path.to_owned(),
            query: query.map(str::to_owned),
        })
    }

    pub fn scheme(&self) -> &str {
        &self.scheme
    }

    /// Java `getAuthority` (raw form; `None` when empty).
    pub fn authority(&self) -> Option<&str> {
        self.authority.as_deref()
    }

    /// Java `getHost`: `None` for registry-based authorities (e.g. containing `_`).
    pub fn host(&self) -> Option<&str> {
        self.host.as_deref()
    }

    /// Java `getPort` (`None` = -1).
    pub fn port(&self) -> Option<u16> {
        self.port
    }

    pub fn raw_path(&self) -> &str {
        &self.raw_path
    }

    /// Java `getPath`: percent-decoded (UTF-8, lossy).
    pub fn path(&self) -> String {
        percent_decode_str(&self.raw_path)
            .decode_utf8_lossy()
            .into_owned()
    }

    pub fn query(&self) -> Option<&str> {
        self.query.as_deref()
    }

    pub fn as_str(&self) -> &str {
        &self.original
    }
}

impl fmt::Display for RemoteUri {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.original)
    }
}

/// Vault-specific part of the canonical [`UPath`] (kept here so the models stay free of URI
/// parsing).
impl UPath {
    /// Scala `toRemoteUri` (`new URI(toString)`).
    pub fn to_remote_uri(&self) -> Result<RemoteUri, DsError> {
        match self {
            Self::Local(_) => Err(DsError::failure(format!(
                "Called toRemoteUri on LocalUPath {self}"
            ))),
            Self::Remote(path) => RemoteUri::parse(&path.to_string()).map_err(DsError::failure),
            Self::ZipEntry(outer, _) => outer.to_remote_uri(),
        }
    }
}

fn split_once_keep(value: &str, separator: char) -> (&str, Option<&str>) {
    match value.split_once(separator) {
        Some((a, b)) => (a, Some(b)),
        None => (value, None),
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Component {
    Authority,
    Path,
    Query,
}

fn check_chars(
    value: &str,
    offset: usize,
    input: &str,
    component: Component,
) -> Result<(), String> {
    let bytes = value.as_bytes();
    let mut i = 0;
    for (index, c) in value.char_indices() {
        if index < i {
            continue;
        }
        if c == '%' {
            let valid = bytes.len() >= index + 3
                && bytes[index + 1].is_ascii_hexdigit()
                && bytes[index + 2].is_ascii_hexdigit();
            if !valid {
                return Err(format!(
                    "Malformed escape pair at index {}: {input}",
                    offset + index
                ));
            }
            i = index + 3;
            continue;
        }
        let allowed = if c.is_ascii() {
            c.is_ascii_alphanumeric()
                || "-_.!~*'();:@&=+$,/".contains(c)
                || (component == Component::Query && "?[]".contains(c))
                || (component == Component::Authority && "[]".contains(c))
        } else {
            !c.is_control() && !c.is_whitespace()
        };
        if !allowed {
            let name = match component {
                Component::Authority => "authority",
                Component::Path => "path",
                Component::Query => "query",
            };
            return Err(format!(
                "Illegal character in {name} at index {}: {input}",
                offset + index
            ));
        }
    }
    Ok(())
}

/// Java's server-based authority parse: `[userinfo@]host[:port]`; on failure the authority is
/// registry-based and host/port are undefined.
fn parse_server_authority(authority: &str) -> (Option<String>, Option<u16>) {
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
    let (host, port) = if host_port.starts_with('[') {
        match host_port.find(']') {
            Some(end) => (&host_port[..=end], &host_port[end + 1..]),
            None => return (None, None),
        }
    } else {
        match host_port.rfind(':') {
            Some(i) => (&host_port[..i], &host_port[i..]),
            None => (host_port, ""),
        }
    };
    let port = match port.strip_prefix(':') {
        None if port.is_empty() => None,
        None => return (None, None),
        Some("") => None,
        Some(digits) if digits.bytes().all(|b| b.is_ascii_digit()) => match digits.parse() {
            Ok(port) => Some(port),
            Err(_) => return (None, None),
        },
        Some(_) => return (None, None),
    };
    if host.is_empty() || !is_valid_host(host) {
        return (None, None);
    }
    (Some(host.to_owned()), port)
}

fn is_valid_host(host: &str) -> bool {
    if let Some(inner) = host.strip_prefix('[') {
        return inner.strip_suffix(']').is_some_and(|v| {
            !v.is_empty() && v.chars().all(|c| c.is_ascii_hexdigit() || ":.".contains(c))
        });
    }
    let labels: Vec<&str> = host.strip_suffix('.').unwrap_or(host).split('.').collect();
    if labels.len() == 4
        && labels.iter().all(|l| {
            !l.is_empty()
                && l.len() <= 3
                && l.bytes().all(|b| b.is_ascii_digit())
                && l.parse::<u16>().is_ok_and(|v| v <= 255)
        })
    {
        return true;
    }
    let label_ok = |l: &&str| {
        let b = l.as_bytes();
        !b.is_empty()
            && b[0].is_ascii_alphanumeric()
            && b[b.len() - 1].is_ascii_alphanumeric()
            && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'-')
    };
    labels.iter().all(label_ok)
        && labels
            .last()
            .is_some_and(|l| l.as_bytes()[0].is_ascii_alphabetic())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upath_to_remote_uri() {
        let upath = UPath::parse("s3://bucket/data.zip|zip:a/b").unwrap();
        assert_eq!(
            upath.to_remote_uri().unwrap().as_str(),
            "s3://bucket/data.zip"
        );
        assert_eq!(
            UPath::parse("/a")
                .unwrap()
                .to_remote_uri()
                .unwrap_err()
                .message,
            "Called toRemoteUri on LocalUPath /a"
        );
        assert!(
            UPath::parse("https://host/a b")
                .unwrap()
                .to_remote_uri()
                .is_err()
        );
    }

    #[test]
    fn parses_like_java_uri() {
        let uri = RemoteUri::parse("https://user@example.com:8443/a%20b/c?x=1#f").unwrap();
        assert_eq!(uri.scheme(), "https");
        assert_eq!(uri.authority(), Some("user@example.com:8443"));
        assert_eq!(uri.host(), Some("example.com"));
        assert_eq!(uri.port(), Some(8443));
        assert_eq!(uri.raw_path(), "/a%20b/c");
        assert_eq!(uri.path(), "/a b/c");
        assert_eq!(uri.query(), Some("x=1"));

        let bucket = RemoteUri::parse("gs://my_bucket/obj").unwrap();
        assert_eq!(bucket.authority(), Some("my_bucket"));
        assert_eq!(bucket.host(), None);
        assert_eq!(RemoteUri::parse("s3://bucket").unwrap().path(), "");
        assert_eq!(RemoteUri::parse("s3://bucket/").unwrap().path(), "/");
        assert_eq!(
            RemoteUri::parse("s3://localhost:9000/b/k").unwrap().port(),
            Some(9000)
        );
        assert_eq!(
            RemoteUri::parse("s3://10.0.0.1/b").unwrap().host(),
            Some("10.0.0.1")
        );
        assert_eq!(RemoteUri::parse("s3://123/b").unwrap().host(), None);
    }

    #[test]
    fn rejects_what_java_rejects() {
        assert_eq!(
            RemoteUri::parse("https://host/a b").unwrap_err(),
            "Illegal character in path at index 14: https://host/a b"
        );
        assert_eq!(
            RemoteUri::parse("https://host/a%zz").unwrap_err(),
            "Malformed escape pair at index 14: https://host/a%zz"
        );
        assert!(RemoteUri::parse("://host").is_err());
        assert!(RemoteUri::parse("ht tp://host").is_err());
        assert!(RemoteUri::parse("https://host/{x}").is_err());
    }
}
