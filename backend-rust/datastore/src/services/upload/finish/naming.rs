//! Name normalization and ObjectId generation.
use std::sync::atomic::Ordering;
use webknossos_common::bytes::array;

/// Scala `TextUtils.normalize` (umlauts and accented letters transliterated).
pub fn normalize_text(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            'ü' => "ue".into(),
            'Ü' => "Ue".into(),
            'ö' => "oe".into(),
            'Ö' => "Oe".into(),
            'ä' => "ae".into(),
            'Ä' => "Ae".into(),
            'ß' => "ss".into(),
            'é' | 'è' | 'ê' | 'ë' => "e".into(),
            'È' | 'É' | 'Ê' | 'Ë' => "E".into(),
            'Ç' => "C".into(),
            'ç' => "c".into(),
            'ñ' => "n".into(),
            'Ñ' => "N".into(),
            'ï' | 'í' | 'ì' => "i".into(),
            'Ï' => "I".into(),
            'å' => "a".into(),
            'Å' => "A".into(),
            'œ' => "oe".into(),
            'Œ' => "Oe".into(),
            'æ' => "ae".into(),
            'Æ' => "Ae".into(),
            'þ' => "th".into(),
            'Þ' => "Th".into(),
            'ø' => "oe".into(),
            'Ø' => "Oe".into(),
            other => other.to_string(),
        })
        .collect()
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
    id.iter().map(|b| format!("{b:02x}")).collect()
}
