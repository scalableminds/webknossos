#[derive(Clone)]
pub struct AppState {
    pub pool: sqlx::PgPool,
}
