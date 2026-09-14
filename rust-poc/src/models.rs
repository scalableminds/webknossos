use serde::Serialize;

/// Maps to a row of `webknossos.multiusers` (holds login credentials).
#[derive(Debug, sqlx::FromRow)]
pub struct MultiUserRow {
    pub _id: String,
    pub email: String,
    pub password_hash: String,
    pub password_hasher: String,
    pub first_name: String,
    pub last_name: String,
}

/// Maps to a row of `webknossos.users` (org-scoped identity, no credentials).
#[derive(Debug, sqlx::FromRow)]
pub struct UserRow {
    pub _id: String,
    pub _multiuser: String,
    pub _organization: String,
    pub is_admin: bool,
    pub is_deactivated: bool,
}

/// JSON shape returned by `GET /me`.
#[derive(Debug, Serialize)]
pub struct CurrentUser {
    pub id: String,
    pub email: String,
    pub first_name: String,
    pub last_name: String,
    pub organization: String,
    pub is_admin: bool,
}
