//! Queries behind the initial data (dev seeding): local stores, the dev worker, AI models and
//! the sample organization with its users, token, task type, project, publications and datasets.
use sqlx::{PgConnection, PgPool};

use super::{
    AiModel, DEFAULT_PUBLICATION_ID, DUMMY_PUBLICATION_ID, SAMPLE_ORGANIZATION_ID, SampleDataset,
    SampleUser,
};
use crate::{
    dataset::source::UsableDataSource, error::ApiResult, sql::Sql,
    system::application_info::LocalStoreConfig, util::id::ObjectId,
};

// ---------------------------------------------------------------------------
// Local stores

/// The name and public URL of the non-deleted store with the url. `table` is one of two fixed
/// identifiers, `dataStores` or `tracingStores`.
pub(super) async fn find_local_store(
    pool: &PgPool,
    table: &str,
    url: &str,
) -> ApiResult<Option<(String, String)>> {
    let mut q = Sql::new("SELECT name, publicUrl FROM webknossos.");
    q.push(table)
        .push("_ WHERE url = ")
        .push_bind(url)
        .push(" LIMIT 1");
    Ok(q.build_query_as().fetch_optional(pool).await?)
}

pub(super) async fn update_local_store_urls(
    pool: &PgPool,
    table: &str,
    store: &LocalStoreConfig,
    url: &str,
    name: String,
) -> ApiResult<()> {
    let mut q = Sql::new("UPDATE webknossos.");
    q.push(table)
        .push(" SET url = ")
        .push_bind(url)
        .push(", publicUrl = ")
        .push_bind(&store.public_uri)
        .push(" WHERE name = ")
        .push_bind(name);
    q.build().execute(pool).await?;
    Ok(())
}

pub(super) async fn insert_local_store(
    pool: &PgPool,
    table: &str,
    store: &LocalStoreConfig,
    url: &str,
) -> ApiResult<()> {
    let (columns, defaults) = if table == "dataStores" {
        (
            ", allowsUpload, allowsUploadToPaths, reportUsedStorageEnabled",
            ", TRUE, TRUE, FALSE",
        )
    } else {
        ("", "")
    };
    let mut q = Sql::new("INSERT INTO webknossos.");
    q.push(table)
        .push("(name, url, publicUrl, key, isDeleted")
        .push(columns)
        .push(") VALUES (")
        .push_bind(&store.name)
        .push(", ")
        .push_bind(url)
        .push(", ")
        .push_bind(&store.public_uri)
        .push(", ")
        .push_bind(&store.key)
        .push(", FALSE")
        .push(defaults)
        .push(")");
    q.build().execute(pool).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Dev worker

pub(super) const DEFAULT_WORKER_ID: &str = "6194dc03040200b0027f28a1";
const DEFAULT_WORKER_NAME: &str = "Dev Worker";
const DEFAULT_WORKER_KEY: &str = "secretWorkerKey";
/// Same as the dbtool.js command enable-jobs.
pub(super) const DEFAULT_WORKER_COMMANDS: [&str; 13] = [
    "compute_mesh_file",
    "compute_segment_index_file",
    "convert_to_wkw",
    "export_tiff",
    "find_largest_segment_id",
    "materialize_volume_annotation",
    "render_animation",
    "align_sections",
    "infer_neurons",
    "infer_instances",
    "infer_mitochondria",
    "train_neuron_model",
    "train_instance_model",
];

/// WorkerDAO.insertOrUpdateSupportedJobCommands for the default dev worker.
pub(super) async fn upsert_default_worker(pool: &PgPool, data_store: &str) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.workers(_id, _dataStore, name, key, maxParallelHighPriorityJobs,
             maxParallelLowPriorityJobs, supportedJobCommands)
           VALUES ($1, $2, $3, $4, 1, 1, $5)
           ON CONFLICT (_id) DO UPDATE SET supportedJobCommands = EXCLUDED.supportedJobCommands"#,
    )
    .bind(DEFAULT_WORKER_ID)
    .bind(data_store)
    .bind(DEFAULT_WORKER_NAME)
    .bind(DEFAULT_WORKER_KEY)
    .bind(DEFAULT_WORKER_COMMANDS.map(String::from).to_vec())
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// AI models

pub(super) async fn insert_ai_model_if_absent<'e, E>(executor: E, model: &AiModel) -> ApiResult<()>
where
    E: sqlx::PgExecutor<'e>,
{
    // AiModelDAO.findOne reads non-deleted models; ON CONFLICT only guards
    // against a concurrent trigger inserting the same fixed id.
    sqlx::query(
        r#"INSERT INTO webknossos.aiModels(_id, _organization, _dataStore, _user, _trainingJob, path,
             uploadToPathIsPending, name, comment, category, created, modified, isDeleted,
             isSuperUserOnly, isPretrained)
           SELECT $1, $2, $3, $4, NULL, NULL, FALSE, $5, $6, $7::webknossos.AI_MODEL_CATEGORY,
             NOW(), NOW(), FALSE, $8, $9
           WHERE NOT EXISTS (SELECT 1 FROM webknossos.aiModels_ WHERE _id = $1)
           ON CONFLICT DO NOTHING"#,
    )
    .bind(model.id)
    .bind(&model.organization)
    .bind(&model.data_store)
    .bind(&model.user)
    .bind(model.name)
    .bind(model.comment)
    .bind(model.category)
    .bind(model.is_super_user_only)
    .bind(model.is_pretrained)
    .execute(executor)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Sample organization

/// Serializes concurrent triggers so only one passes the emptiness check.
pub(super) async fn lock_initial_data(connection: &mut PgConnection) -> ApiResult<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('webknossos.initialData'))")
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn are_organizations_present(connection: &mut PgConnection) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_)")
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_root_folder(
    connection: &mut PgConnection,
    id: &ObjectId,
    name: &str,
) -> ApiResult<()> {
    sqlx::query("INSERT INTO webknossos.folders(_id, name, created) VALUES ($1, $2, NOW())")
        .bind(id)
        .bind(name)
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn insert_root_folder_path(
    connection: &mut PgConnection,
    id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES ($1, $1, 0)",
    )
    .bind(id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn insert_sample_organization(
    connection: &mut PgConnection,
    id: &str,
    additional_information: &str,
    name: &str,
    root_folder: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.organizations(_id, additionalInformation, logoUrl, name, _rootFolder,
             newUserMailingList, enableAutoVerify, pricingPlan, aiPlan, paidUntil, includedUsers,
             includedStorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion,
             created, isDeleted)
           VALUES ($1, $2, '/images/logo.svg', $3, $4, '', FALSE, 'Custom', 'Power_AI', NULL, NULL,
             NULL, NULL, 0, NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(additional_information)
    .bind(name)
    .bind(root_folder)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn are_teams_present(connection: &mut PgConnection) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.teams_)")
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_default_team(
    connection: &mut PgConnection,
    id: &ObjectId,
    organization: &str,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted) VALUES ($1, $2, 'Default', NOW(), TRUE, FALSE)",
    )
    .bind(id)
    .bind(organization)
    .execute(connection)
    .await?;
    Ok(())
}

/// userService.userFromMultiUserEmail (last logged-in identity, else the first user).
pub(super) async fn find_user_id_by_multi_user_email(
    connection: &mut PgConnection,
    email: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT u._id FROM webknossos.multiUsers_ m
           JOIN webknossos.users_ u ON u._multiUser = m._id
           WHERE m.email = $1
           ORDER BY (u._id = m._lastLoggedInIdentity) DESC, u.created, u._id LIMIT 1"#,
    )
    .bind(email)
    .fetch_optional(connection)
    .await?)
}

pub(super) async fn insert_multi_user(
    connection: &mut PgConnection,
    id: &ObjectId,
    user: &SampleUser<'_>,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.multiUsers(_id, email, passwordInfo_hasher, passwordInfo_password,
             firstName, lastName, isSuperUser, novelUserExperienceInfos, selectedTheme, created,
             isEmailVerified, isDeleted)
           VALUES ($1, $2, 'SCrypt', $3, $4, $5, $6, '{}', 'auto', NOW(), TRUE, FALSE)"#,
    )
    .bind(id)
    .bind(user.email)
    .bind(&user.password_hash)
    .bind(user.first_name)
    .bind(user.last_name)
    .bind(user.is_super_user)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn insert_sample_user(
    connection: &mut PgConnection,
    id: &ObjectId,
    multi_user: &ObjectId,
    is_admin: bool,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted,
             loggedOutEverywhereTime, created, isDeleted)
           VALUES ($1, $2, $3, NOW(), '{}', FALSE, $4, $4, $4, FALSE, NULL, NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(multi_user)
    .bind(SAMPLE_ORGANIZATION_ID)
    .bind(is_admin)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn delete_user_experiences(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query("DELETE FROM webknossos.user_experiences WHERE _user = $1")
        .bind(user_id)
        .execute(connection)
        .await?;
    Ok(())
}

pub(super) async fn insert_sample_experience(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_experiences(_user, domain, value) VALUES ($1, 'sampleExp', 10)",
    )
    .bind(user_id)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn insert_sample_experience_domain(
    connection: &mut PgConnection,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.experienceDomains(domain, _organization) VALUES ('sampleExp', $1) ON CONFLICT DO NOTHING",
    )
    .bind(SAMPLE_ORGANIZATION_ID)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn insert_user_team_role(
    connection: &mut PgConnection,
    user_id: &ObjectId,
    team: &ObjectId,
    is_team_manager: bool,
) -> ApiResult<()> {
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user, _team, isTeamManager) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(team)
    .bind(is_team_manager)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn is_authentication_token_present(
    connection: &mut PgConnection,
    user_id: &ObjectId,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.tokens_ WHERE _user = $1 AND tokenType = 'Authentication')",
    )
    .bind(user_id)
    .fetch_one(connection)
    .await?)
}

pub(super) async fn insert_authentication_token(
    connection: &mut PgConnection,
    value: &str,
    user_id: &ObjectId,
    expiry_millis: i64,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.tokens(_id, value, _user, lastUsedDateTime, expirationDateTime,
                 idleTimeout, tokenType, created, isDeleted)
               VALUES ($1, $2, $3, NOW(), NOW() + make_interval(secs => $4::float8 / 1000), NULL,
                 'Authentication', NOW(), FALSE)"#,
    )
    .bind(ObjectId::new())
    .bind(value)
    .bind(user_id)
    .bind(expiry_millis)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn are_task_types_present(connection: &mut PgConnection) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.taskTypes_)")
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_sample_task_type(
    connection: &mut PgConnection,
    id: &str,
    organization: &str,
    team: &ObjectId,
) -> ApiResult<()> {
    // TaskType defaults: AnnotationSettings.defaultFor(skeleton).
    sqlx::query(
        r#"INSERT INTO webknossos.taskTypes(_id, _organization, _team, summary, description,
                 settings_allowedModes, settings_preferredMode, settings_branchPointsAllowed,
                 settings_somaClickingAllowed, settings_volumeInterpolationAllowed, settings_mergerMode,
                 settings_magRestrictions_min, settings_magRestrictions_max, recommendedConfiguration,
                 tracingType, created, isDeleted)
               VALUES ($1, $2, $3, 'sampleTaskType', 'Check those cells out!',
                 '{orthogonal,flight}', NULL, TRUE, TRUE, TRUE, FALSE, NULL, NULL, NULL,
                 'skeleton', NOW(), FALSE)"#,
    )
    .bind(id)
    .bind(organization)
    .bind(team)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn are_projects_present(connection: &mut PgConnection) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.projects_)")
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_sample_project(
    connection: &mut PgConnection,
    organization: &str,
    team: &ObjectId,
    owner: String,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.projects(_id, _organization, _team, _owner, name, priority,
                 paused, expectedTime, isBlacklistedFromReport, created, isDeleted)
               VALUES ($1, $2, $3, $4, 'sampleProject', 100, FALSE, 5400000, FALSE, NOW(), FALSE)"#,
    )
    .bind(ObjectId::new())
    .bind(organization)
    .bind(team)
    .bind(owner)
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn are_publications_present(connection: &mut PgConnection) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.publications_)")
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_sample_publications(connection: &mut PgConnection) -> ApiResult<()> {
    const DEFAULT_DESCRIPTION: &str = r#"Serial block-face scanning electron microscopy volume from layer 4 of mouse primary somatosensory cortex (P28).

A Motta, M Berning, KM Boergens, B Staffler, M Beining, S Loomba, P Hennig, H Wissler, M Helmstaedter\
Science. 24 October 2019. [10.1126/science.aay3134](https://doi.org/10.1126/science.aay3134)\
© Max Planck Institute for Brain Research, Frankfurt, Germany\
Data available at [https://l4dense2019.brain.mpg.de/](https://l4dense2019.brain.mpg.de/)"#;
    sqlx::query(
        r#"INSERT INTO webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
           VALUES ($1, to_timestamp(1571875200), NULL, $2, $3, NOW(), FALSE),
                  ($4, to_timestamp(1514764800), $5, $6, $7, NOW(), FALSE)"#,
    )
    .bind(DEFAULT_PUBLICATION_ID)
    .bind("Dense connectomic reconstruction in layer 4 of the somatosensory cortex")
    .bind(DEFAULT_DESCRIPTION)
    .bind(DUMMY_PUBLICATION_ID)
    .bind("https://static.webknossos.org/images/icon-only.svg")
    .bind("Dummy publication with several datasets")
    .bind("Doe, J., Roe, R. · *Nature Methods* 2018 · [DOI](https://github.com/scalableminds/webknossos)")
    .execute(connection)
    .await?;
    Ok(())
}

pub(super) async fn is_dataset_present(connection: &mut PgConnection, id: &str) -> ApiResult<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(id)
            .fetch_one(connection)
            .await?,
    )
}

pub(super) async fn insert_sample_dataset(
    connection: &mut PgConnection,
    dataset: &SampleDataset,
    source: &UsableDataSource,
    data_store: &str,
    uploader: &ObjectId,
    folder: &ObjectId,
) -> ApiResult<()> {
    sqlx::query(
        r#"INSERT INTO webknossos.datasets(_id, _dataStore, _organization, _publication, _uploader,
             _folder, inboxSourceHash, defaultViewConfiguration, adminViewConfiguration, description,
             directoryName, isPublic, isUsable, isVirtual, name, voxelSizeFactor, voxelSizeUnit,
             status, sharingToken, sortingKey, metadata, tags, creationType, importURL, rootPath,
             rootRealPath, mirrorPath, created, isDeleted)
           VALUES ($1, $2, $3, $4, $5, $6, NULL, NULL, NULL, $7, $8, $9, TRUE, TRUE, $10,
             ROW($11, $12, $13)::webknossos.VECTOR3, $14::webknossos.LENGTH_UNIT, '', NULL, NOW(),
             $15, '{}', NULL, NULL, NULL, NULL, NULL, NOW(), FALSE)"#,
    )
    .bind(dataset.id)
    .bind(data_store)
    .bind(&source.id.organization_id)
    .bind(dataset.publication)
    .bind(uploader)
    .bind(folder)
    .bind(dataset.description)
    .bind(&source.id.directory_name)
    .bind(dataset.is_public)
    .bind(&dataset.name)
    .bind(source.scale.factor.x)
    .bind(source.scale.factor.y)
    .bind(source.scale.factor.z)
    .bind(source.scale.unit.as_str())
    .bind(&dataset.metadata)
    .execute(connection)
    .await?;
    Ok(())
}
