#![allow(dead_code)]

use std::str::FromStr;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{ConnectOptions, PgPool};
use uuid::Uuid;

/// Every test receives a freshly CREATED database, never the database in the URL.
/// The configured PostgreSQL role must have CREATEDB and access to its own databases.
pub struct TestDb {
    pub pool: PgPool,
    admin: PgPool,
    database_name: String,
}

pub struct Fixture {
    pub user_id: String,
    pub organization_id: String,
    pub token: String,
    pub team_id: String,
    pub multi_user_id: String,
}

pub struct UserFixture {
    pub user_id: String,
    pub organization_id: String,
    pub multi_user_id: String,
    pub token: String,
}

pub fn object_id() -> String {
    Uuid::new_v4().simple().to_string()[..24].to_owned()
}

impl TestDb {
    pub fn connection_url(&self) -> String {
        let mut url =
            url::Url::parse(&std::env::var("WK_RUST_TEST_DATABASE_URL").expect("test URL"))
                .expect("valid test URL");
        url.set_path(&self.database_name);
        url.to_string()
    }

    pub async fn new() -> Self {
        let url = std::env::var("WK_RUST_TEST_DATABASE_URL")
            .expect("Set WK_RUST_TEST_DATABASE_URL to an administrative PostgreSQL connection");
        let options = PgConnectOptions::from_str(&url)
            .unwrap_or_else(|_| panic!("Invalid WK_RUST_TEST_DATABASE_URL"))
            .disable_statement_logging();
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect_with(options.clone())
            .await
            .unwrap_or_else(|_| panic!("Cannot connect to the PostgreSQL test administrator"));
        let database_name = format!("wk_rust_test_{}", Uuid::new_v4().simple());
        // The identifier is exclusively a fixed prefix and generated hexadecimal UUID.
        sqlx::query(&format!("CREATE DATABASE {database_name}"))
            .execute(&admin)
            .await
            .unwrap_or_else(|_| {
                panic!("Cannot CREATE the isolated test database (CREATEDB required)")
            });
        let pool = match PgPoolOptions::new()
            .max_connections(5)
            .connect_with(options.database(&database_name))
            .await
        {
            Ok(pool) => pool,
            Err(_) => {
                sqlx::query(&format!("DROP DATABASE {database_name}"))
                    .execute(&admin)
                    .await
                    .expect("Cannot clean up failed test database");
                panic!("Cannot connect to the isolated test database");
            }
        };
        let database = Self {
            pool,
            admin,
            database_name,
        };
        let schema = include_str!("../../../schema/schema.sql");
        if sqlx::raw_sql(schema).execute(&database.pool).await.is_err() {
            database.cleanup().await;
            panic!("Cannot initialize the isolated test database from schema/schema.sql");
        }
        database
    }

    pub async fn fixture(&self) -> Fixture {
        let organization_id = format!("rust-test-{}", Uuid::new_v4().simple());
        let user_id = object_id();
        let user = self.seed_user(&user_id, &organization_id, true).await;
        let team_id = object_id();
        sqlx::query(
            "INSERT INTO webknossos.teams (_id, _organization, name) VALUES ($1, $2, 'Test team')",
        )
        .bind(&team_id)
        .bind(&organization_id)
        .execute(&self.pool)
        .await
        .expect("Cannot seed test team");
        Fixture {
            user_id,
            organization_id,
            token: user.token,
            team_id,
            multi_user_id: user.multi_user_id,
        }
    }

    pub async fn seed_user(
        &self,
        user_id: &str,
        organization_id: &str,
        is_admin: bool,
    ) -> UserFixture {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM webknossos.organizations WHERE _id = $1)",
        )
        .bind(organization_id)
        .fetch_one(&self.pool)
        .await
        .expect("Cannot query fixture organization");
        if !exists {
            let root_folder = object_id();
            sqlx::query("INSERT INTO webknossos.folders (_id, name) VALUES ($1, 'Test root')")
                .bind(&root_folder)
                .execute(&self.pool)
                .await
                .expect("Cannot seed root folder");
            sqlx::query("INSERT INTO webknossos.folder_paths (_ancestor, _descendant, depth) VALUES ($1, $1, 0)")
                .bind(&root_folder).execute(&self.pool).await.expect("Cannot seed root closure path");
            sqlx::query("INSERT INTO webknossos.organizations (_id, _rootFolder, name) VALUES ($1, $2, 'Test organization')")
                .bind(organization_id).bind(root_folder).execute(&self.pool).await.expect("Cannot seed organization");
        }
        let multi_user = object_id();
        sqlx::query("INSERT INTO webknossos.multiUsers (_id, email, passwordInfo_password, firstName, lastName) VALUES ($1, $2, '', 'Rust', 'Test')")
            .bind(&multi_user).bind(format!("{multi_user}@example.test"))
            .execute(&self.pool).await.expect("Cannot seed account");
        sqlx::query("INSERT INTO webknossos.users (_id, _multiUser, _organization, userConfiguration, isAdmin) VALUES ($1, $2, $3, '{}'::jsonb, $4)")
            .bind(user_id).bind(&multi_user).bind(organization_id).bind(is_admin)
            .execute(&self.pool).await.expect("Cannot seed user");
        UserFixture {
            user_id: user_id.to_owned(),
            organization_id: organization_id.to_owned(),
            multi_user_id: multi_user,
            token: self.seed_token(user_id, "Authentication").await,
        }
    }

    pub async fn seed_token(&self, user_id: &str, token_type: &str) -> String {
        let token = format!("rust-test-token-{}", Uuid::new_v4().simple());
        sqlx::query(
            "INSERT INTO webknossos.tokens (_id, value, _user, lastUsedDateTime, expirationDateTime, tokenType, created) VALUES ($1, $2, $3, NOW() - INTERVAL '1 minute', NOW() + INTERVAL '1 hour', $4::webknossos.TOKEN_TYPES, NOW() - INTERVAL '1 minute')"
        )
            .bind(object_id()).bind(&token).bind(user_id).bind(token_type)
            .execute(&self.pool).await.expect("Cannot seed token");
        token
    }

    pub async fn cleanup(self) {
        assert!(
            self.database_name.starts_with("wk_rust_test_")
                && self.database_name[13..].len() == 32
                && self.database_name[13..]
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit())
        );
        self.pool.close().await;
        sqlx::query(&format!(
            "DROP DATABASE {} WITH (FORCE)",
            self.database_name
        ))
        .execute(&self.admin)
        .await
        .expect("Cannot DROP the isolated test database");
        self.admin.close().await;
    }
}
