//! Test-only helper: prints a bcrypt hash for a given plaintext password, in the same
//! `$2a$10$...` format webKnossos stores in `multiusers.passwordinfo_password`. Used to
//! seed a test user for the PoC's manual verification — not part of the PoC service.
fn main() {
    let password = std::env::args()
        .nth(1)
        .expect("usage: gen_hash <plaintext-password>");
    let hash = bcrypt::hash(password, 10).expect("hashing failed");
    println!("{hash}");
}
