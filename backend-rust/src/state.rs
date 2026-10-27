#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}

impl AppState {
    pub fn new(pool: sqlx::PgPool) -> Self {
        Self { pool }
    }
}
