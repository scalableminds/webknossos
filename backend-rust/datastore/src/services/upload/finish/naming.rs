//! Name normalization and ObjectId generation.
use std::{fmt::Write, sync::atomic::Ordering};
use webknossos_common::bytes::array;

/// Scala `TextUtils.normalize` (umlauts and accented letters transliterated).
pub fn normalize_text(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    for c in name.chars() {
        match transliteration(c) {
            Some(replacement) => out.push_str(replacement),
            None => out.push(c),
        }
    }
    out
}

fn transliteration(c: char) -> Option<&'static str> {
    Some(match c {
        'ü' => "ue",
        'Ü' => "Ue",
        'ö' => "oe",
        'Ö' => "Oe",
        'ä' => "ae",
        'Ä' => "Ae",
        'ß' => "ss",
        'é' | 'è' | 'ê' | 'ë' => "e",
        'È' | 'É' | 'Ê' | 'Ë' => "E",
        'Ç' => "C",
        'ç' => "c",
        'ñ' => "n",
        'Ñ' => "N",
        'ï' | 'í' | 'ì' => "i",
        'Ï' => "I",
        'å' => "a",
        'Å' => "A",
        'œ' => "oe",
        'Œ' => "Oe",
        'æ' => "ae",
        'Æ' => "Ae",
        'þ' => "th",
        'Þ' => "Th",
        'ø' => "oe",
        'Ø' => "Oe",
        _ => return None,
    })
}

/// Scala `TextUtils.normalizeStrong` (Option rendered like Scala string interpolation).
pub(super) fn normalize_strong_rendered(name: &str) -> String {
    let replaced: String = normalize_text(name)
        .chars()
        .filter(|c| {
            c.is_ascii_alphanumeric()
                || matches!(c, '_' | '-' | ' ' | '\t' | '\n' | '\x0B' | '\x0C' | '\r')
        })
        .collect();
    // Scala interpolates the `Option[String]` itself.
    if replaced.is_empty() {
        "None".into()
    } else {
        format!("Some({replaced})")
    }
}

/// Scala `ObjectId.generate`: seconds, 5 process-random bytes, 3-byte counter.
pub(super) fn generate_object_id() -> String {
    use std::sync::OnceLock;
    static PROCESS: OnceLock<[u8; 5]> = OnceLock::new();
    static COUNTER: OnceLock<std::sync::atomic::AtomicU32> = OnceLock::new();
    let random = |n: usize| {
        let mut bytes = [0u8; 8];
        ring::rand::SecureRandom::fill(&ring::rand::SystemRandom::new(), &mut bytes[..n]).ok();
        bytes
    };
    let process = PROCESS.get_or_init(|| array(&random(5)));
    let counter = COUNTER.get_or_init(|| {
        let b = random(3);
        std::sync::atomic::AtomicU32::new(u32::from_be_bytes([0, b[0], b[1], b[2]]))
    });
    let c = counter.fetch_add(1, Ordering::Relaxed) & 0xff_ffff;
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs()) as u32;
    let mut id = Vec::with_capacity(12);
    id.extend(seconds.to_be_bytes());
    id.extend(process);
    id.extend(&c.to_be_bytes()[1..]);
    id.iter().fold(String::with_capacity(24), |mut hex, b| {
        let _ = write!(hex, "{b:02x}");
        hex
    })
}
