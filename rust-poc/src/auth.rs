use rand::Rng;

/// Verifies a plaintext password against a hash produced by webKnossos's
/// `com.scalableminds.util.security.SCrypt.hashPassword` — despite the name, that's a
/// bcrypt hash (`at.favre.lib:bcrypt`, version 2a, cost 10), so the standard `bcrypt`
/// crate reads it directly.
pub fn verify_password(plain: &str, hash: &str) -> bool {
    bcrypt::verify(plain, hash).unwrap_or(false)
}

/// Generates a 24-hex-char id matching webKnossos's `ObjectId` format
/// (`^[0-9a-f]{24}$`, enforced by a CHECK constraint on every `_id` column).
pub fn generate_object_id() -> String {
    hex_string(12)
}

/// Generates an opaque bearer token value (webKnossos's tokens are random strings
/// stored in Postgres, not JWTs, so no signing/verification library is needed here).
pub fn generate_token_value() -> String {
    hex_string(32)
}

fn hex_string(num_bytes: usize) -> String {
    let mut bytes = vec![0u8; num_bytes];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
