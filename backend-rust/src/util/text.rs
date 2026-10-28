/// TextUtils.normalizeStrong: transliterate, then keep `[A-Za-z0-9_\-\s]`.
pub(crate) fn normalize_strong(value: &str) -> Option<String> {
    let mut normalized = String::new();
    for c in value.chars() {
        let replacement = match c {
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
            'œ' | 'ø' => "oe",
            'Œ' | 'Ø' => "Oe",
            'æ' => "ae",
            'Æ' => "Ae",
            'þ' => "th",
            'Þ' => "Th",
            _ => {
                // Java's \s: space, \t, \n, \x0B, \f, \r.
                if c.is_ascii_alphanumeric()
                    || matches!(c, '_' | '-' | ' ' | '\t' | '\n' | '\x0B' | '\x0C' | '\r')
                {
                    normalized.push(c);
                }
                continue;
            }
        };
        normalized.push_str(replacement);
    }
    (!normalized.is_empty()).then_some(normalized)
}

#[cfg(test)]
mod tests;
