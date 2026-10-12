//! Play's `InitialDataController` / `InitialDataService`
//! (`POST /triggers/initialData`, a UserAwareAction that ignores the user).
//!
//! Always: keep the local datastore/tracingstore rows in sync with the
//! configuration and insert the pretrained AI models (local datastore only).
//! Then, only when the sample organization is enabled and no organization
//! exists yet: insert the sample organization with its users, token, task
//! type, project, publications, virtual datasets and custom AI model.
//!
//! Differences from Play: the sample-organization inserts run in one
//! transaction (Play runs them one by one), the organization-directory RPC
//! runs after that commit, and `inboxSourceHash` stays NULL because Scala's
//! case-class `hashCode` cannot be reproduced (virtual datasets never compare
//! it against a datastore report).
use axum::{Extension, Router, extract::State, response::Response, routing::post};
use serde_json::{Value, json};

use crate::{
    AppState,
    application_info::{LocalStoreConfig, MiscConfig, MiscState, ok_empty},
    dataset_source,
    error::{ApiError, ApiResult},
    id::ObjectId,
    service_clients::ServiceClients,
};

pub const INITIAL_DATA_NOT_ENABLED: &str =
    "Initial data (sample organization) is not enabled for this WEBKNOSSOS instance.";
pub const ORGANIZATIONS_PRESENT: &str = "There are already organizations present in the database. To reset initial data, please refresh the database schema and try again.";

pub const SAMPLE_ORGANIZATION_ID: &str = "sample_organization";
const SAMPLE_ORGANIZATION_NAME: &str = "Sample Organization";
const SAMPLE_ORGANIZATION_INFORMATION: &str =
    "**Sample Organization**\n\nSample Street 123\nSampletown\nSamplecountry\n";
const ROOT_FOLDER_NAME: &str = "Datasets";
const SAMPLE_TASK_TYPE_ID: &str = "63721e2cef0100470266c485";
const DEFAULT_PUBLICATION_ID: &str = "5c766bec6c01006c018c7459";
const SINGLE_DATASET_PUBLICATION_ID: &str = "6ac000000000000000000001";
const DEFAULT_DATASET_ID: &str = "68b80290d4000090f8f4aa62";
const REMOTE_ND_DATASET_ID: &str = "05c85a876c4c979ef53752b4";
const CUSTOM_AI_MODEL_ID: &str = "66544a56d20000af0e42ba0f";
/// AiModelService.pretrained*ModelId
pub const PRETRAINED_AI_MODEL_IDS: [&str; 4] = [
    "576500000000000000000001",
    "576500000000000000000002",
    "576500000000000000000003",
    "576500000000000000000004",
];
const L4_VOXEL_SIZE: f64 = 11.239999771118164;

pub fn router() -> Router<AppState> {
    Router::new().route("/triggers/initialData", post(trigger_insert))
}

async fn trigger_insert(
    State(state): State<AppState>,
    Extension(misc): Extension<MiscState>,
    clients: Option<Extension<ServiceClients>>,
) -> ApiResult<Response> {
    let config = misc.config();
    let pool = &state.pool;
    if let Some(store) = &config.local_datastore {
        sync_local_store(pool, "dataStores", store, &config.public_uri).await?;
    }
    if let Some(store) = &config.local_tracingstore {
        sync_local_store(pool, "tracingStores", store, &config.public_uri).await?;
    }
    if let Some(store) = &config.local_datastore {
        for model in pretrained_ai_models(&store.name) {
            insert_ai_model_if_absent(pool, &model).await?;
        }
    }
    // Everything below only runs in the dev setup.
    if !config.sample_organization.enabled {
        return Err(ApiError::bad_request(INITIAL_DATA_NOT_ENABLED));
    }
    insert_sample_organization(&state, config).await?;
    if let Some(Extension(clients)) = clients {
        create_organization_directory(pool, &clients).await;
    }
    Ok(ok_empty())
}

// ---------------------------------------------------------------------------
// Local stores

/// update*PublicUri followed by insert*IfEnabled, matched by `url = http.uri`
/// among non-deleted stores.
async fn sync_local_store(
    pool: &sqlx::PgPool,
    table: &str,
    store: &LocalStoreConfig,
    url: &str,
) -> ApiResult<()> {
    // `table` is one of two fixed identifiers.
    debug_assert!(matches!(table, "dataStores" | "tracingStores"));
    let existing: Option<(String, String)> = sqlx::query_as(&format!(
        "SELECT name, publicUrl FROM webknossos.{table}_ WHERE url = $1 LIMIT 1"
    ))
    .bind(url)
    .fetch_optional(pool)
    .await?;
    match existing {
        Some((name, public_url)) => {
            if public_url != store.public_uri {
                sqlx::query(&format!(
                    "UPDATE webknossos.{table} SET url = $2, publicUrl = $3 WHERE name = $1"
                ))
                .bind(name)
                .bind(url)
                .bind(&store.public_uri)
                .execute(pool)
                .await?;
            }
        }
        None => {
            tracing::info!(table, "Inserting local store");
            let columns = if table == "dataStores" {
                "name, url, publicUrl, key, isScratch, isDeleted, allowsUpload, allowsUploadToPaths, reportUsedStorageEnabled) VALUES ($1, $2, $3, $4, FALSE, FALSE, TRUE, TRUE, FALSE)"
            } else {
                "name, url, publicUrl, key, isDeleted) VALUES ($1, $2, $3, $4, FALSE)"
            };
            sqlx::query(&format!("INSERT INTO webknossos.{table}({columns}"))
                .bind(&store.name)
                .bind(url)
                .bind(&store.public_uri)
                .bind(&store.key)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// AI models

struct AiModel {
    id: &'static str,
    organization: Option<String>,
    data_store: String,
    user: Option<String>,
    name: &'static str,
    comment: &'static str,
    category: &'static str,
    is_super_user_only: bool,
    is_pretrained: bool,
}

fn pretrained_ai_models(data_store: &str) -> Vec<AiModel> {
    let model = |index: usize, name, comment, category, is_super_user_only| AiModel {
        id: PRETRAINED_AI_MODEL_IDS[index],
        organization: None,
        data_store: data_store.to_owned(),
        user: None,
        name,
        comment,
        category,
        is_super_user_only,
        is_pretrained: true,
    };
    vec![
        model(
            0,
            "Neuron Segmentation",
            "Advanced neuron segmentation and reconstruction pipeline. Optimized for dense neuronal tissue from SEM, FIB-SEM, SBEM, Multi-SEM microscopes.",
            "em_neurons",
            false,
        ),
        model(
            1,
            "Mitochondria Detection",
            "Instance segmentation model for mitochondria detection. Optimized for EM data. Powered by [MitoNet (Conrad & Narayan 2022)](https://volume-em.github.io/empanada).",
            "em_mitochondria",
            false,
        ),
        model(
            2,
            "Nuclei Detection",
            "Instance segmentation model for nuclei detection. Optimized for EM data.",
            "em_nuclei",
            true,
        ),
        model(
            3,
            "Soma Detection",
            "Instance segmentation model for soma detection. Optimized for EM data.",
            "em_somata",
            true,
        ),
    ]
}

async fn insert_ai_model_if_absent<'e, E>(executor: E, model: &AiModel) -> ApiResult<()>
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

struct SampleUser<'a> {
    email: &'a str,
    first_name: &'a str,
    last_name: &'a str,
    is_super_user: bool,
    is_admin: bool,
    is_team_manager: bool,
    password_hash: String,
}

async fn insert_sample_organization(state: &AppState, config: &MiscConfig) -> ApiResult<()> {
    let sample = &config.sample_organization;
    // Hash outside the transaction (bcrypt is slow); like Play, each account
    // gets its own salt.
    let first_hash = crate::browser_auth::hash_password(sample.password.clone()).await?;
    let second_hash = crate::browser_auth::hash_password(sample.password.clone()).await?;

    let mut tx = state.pool.begin().await?;
    // Serialize concurrent triggers so only one passes the emptiness check.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext('webknossos.initialData'))")
        .execute(&mut *tx)
        .await?;
    let organizations_present: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.organizations_)")
            .fetch_one(&mut *tx)
            .await?;
    if organizations_present {
        return Err(ApiError::bad_request(ORGANIZATIONS_PRESENT));
    }

    let organization = SAMPLE_ORGANIZATION_ID;
    let root_folder = ObjectId::new();
    let team = ObjectId::new();
    let user_id = ObjectId::new();

    sqlx::query("INSERT INTO webknossos.folders(_id, name, created) VALUES ($1, $2, NOW())")
        .bind(root_folder.as_str())
        .bind(ROOT_FOLDER_NAME)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        "INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES ($1, $1, 0)",
    )
    .bind(root_folder.as_str())
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO webknossos.organizations(_id, additionalInformation, logoUrl, name, _rootFolder,
             newUserMailingList, enableAutoVerify, pricingPlan, aiPlan, paidUntil, includedUsers,
             includedStorage, lastTermsOfServiceAcceptanceTime, lastTermsOfServiceAcceptanceVersion,
             created, isDeleted)
           VALUES ($1, $2, '/images/logo.svg', $3, $4, '', FALSE, 'Custom', 'Power_AI', NULL, NULL,
             NULL, NULL, 0, NOW(), FALSE)"#,
    )
    .bind(organization)
    .bind(SAMPLE_ORGANIZATION_INFORMATION)
    .bind(SAMPLE_ORGANIZATION_NAME)
    .bind(root_folder.as_str())
    .execute(&mut *tx)
    .await?;
    let teams_present: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.teams_)")
        .fetch_one(&mut *tx)
        .await?;
    if !teams_present {
        sqlx::query(
            "INSERT INTO webknossos.teams(_id, _organization, name, created, isOrganizationTeam, isDeleted) VALUES ($1, $2, 'Default', NOW(), TRUE, FALSE)",
        )
        .bind(team.as_str())
        .bind(organization)
        .execute(&mut *tx)
        .await?;
    }

    let users = [
        (
            user_id.as_str().to_owned(),
            SampleUser {
                email: &sample.email,
                first_name: "Sample",
                last_name: "User",
                is_super_user: sample.is_super_user,
                is_admin: true,
                is_team_manager: true,
                password_hash: first_hash,
            },
        ),
        (
            ObjectId::new().as_str().to_owned(),
            SampleUser {
                email: &sample.email2,
                first_name: "Non-Admin",
                last_name: "User",
                is_super_user: false,
                is_admin: false,
                is_team_manager: false,
                password_hash: second_hash,
            },
        ),
    ];
    for (id, user) in &users {
        insert_default_user(&mut tx, id, user, team.as_str()).await?;
    }

    // insertToken: one Authentication token for the default user.
    let token_present: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM webknossos.tokens_ WHERE _user = $1 AND tokenType = 'Authentication')",
    )
    .bind(user_id.as_str())
    .fetch_one(&mut *tx)
    .await?;
    if !token_present {
        let expiry_millis = i64::try_from(config.authenticator_expiry.as_millis())
            .map_err(|_| ApiError::internal())?;
        sqlx::query(
            r#"INSERT INTO webknossos.tokens(_id, value, _user, lastUsedDateTime, expirationDateTime,
                 idleTimeout, tokenType, created, isDeleted)
               VALUES ($1, $2, $3, NOW(), NOW() + make_interval(secs => $4::float8 / 1000), NULL,
                 'Authentication', NOW(), FALSE)"#,
        )
        .bind(ObjectId::new().as_str())
        .bind(&sample.token)
        .bind(user_id.as_str())
        .bind(expiry_millis)
        .execute(&mut *tx)
        .await?;
    }

    let task_types_present: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.taskTypes_)")
            .fetch_one(&mut *tx)
            .await?;
    if !task_types_present {
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
        .bind(SAMPLE_TASK_TYPE_ID)
        .bind(organization)
        .bind(team.as_str())
        .execute(&mut *tx)
        .await?;
    }

    let projects_present: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.projects_)")
            .fetch_one(&mut *tx)
            .await?;
    if !projects_present {
        let owner = user_for_email(&mut tx, &sample.email)
            .await?
            .ok_or_else(|| ApiError::not_found("User could not be found."))?;
        sqlx::query(
            r#"INSERT INTO webknossos.projects(_id, _organization, _team, _owner, name, priority,
                 paused, expectedTime, isBlacklistedFromReport, created, isDeleted)
               VALUES ($1, $2, $3, $4, 'sampleProject', 100, FALSE, 5400000, FALSE, NOW(), FALSE)"#,
        )
        .bind(ObjectId::new().as_str())
        .bind(organization)
        .bind(team.as_str())
        .bind(owner)
        .execute(&mut *tx)
        .await?;
    }

    let publications_present: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.publications_)")
            .fetch_one(&mut *tx)
            .await?;
    if !publications_present {
        insert_publications(&mut tx).await?;
    }

    if let Some(store) = &config.local_datastore {
        for dataset in sample_datasets() {
            insert_dataset_if_absent(
                &mut tx,
                &dataset,
                &store.name,
                user_id.as_str(),
                root_folder.as_str(),
            )
            .await?;
        }
        insert_ai_model_if_absent(
            &mut *tx,
            &AiModel {
                id: CUSTOM_AI_MODEL_ID,
                organization: Some(organization.to_owned()),
                data_store: store.name.clone(),
                user: Some(user_id.as_str().to_owned()),
                name: "sample_ai_model",
                comment: "Works if model files are manually placed at binaryData/sample_organization/66544a56d20000af0e42ba0f/",
                category: "em_neurons",
                is_super_user_only: false,
                is_pretrained: false,
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// userService.userFromMultiUserEmail (last logged-in identity, else the first user).
async fn user_for_email(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    email: &str,
) -> ApiResult<Option<String>> {
    Ok(sqlx::query_scalar(
        r#"SELECT u._id FROM webknossos.multiUsers_ m
           JOIN webknossos.users_ u ON u._multiUser = m._id
           WHERE m.email = $1
           ORDER BY (u._id = m._lastLoggedInIdentity) DESC, u.created, u._id LIMIT 1"#,
    )
    .bind(email)
    .fetch_optional(&mut **tx)
    .await?)
}

async fn insert_default_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &str,
    user: &SampleUser<'_>,
    team: &str,
) -> ApiResult<()> {
    if user_for_email(tx, user.email).await?.is_some() {
        return Ok(());
    }
    let multi_user = ObjectId::new();
    sqlx::query(
        r#"INSERT INTO webknossos.multiUsers(_id, email, passwordInfo_hasher, passwordInfo_password,
             firstName, lastName, isSuperUser, novelUserExperienceInfos, selectedTheme, created,
             isEmailVerified, isDeleted)
           VALUES ($1, $2, 'SCrypt', $3, $4, $5, $6, '{}', 'auto', NOW(), TRUE, FALSE)"#,
    )
    .bind(multi_user.as_str())
    .bind(user.email)
    .bind(&user.password_hash)
    .bind(user.first_name)
    .bind(user.last_name)
    .bind(user.is_super_user)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        r#"INSERT INTO webknossos.users(_id, _multiUser, _organization, lastActivity, userConfiguration,
             isDeactivated, isAdmin, isOrganizationOwner, isDatasetManager, isUnlisted,
             loggedOutEverywhereTime, created, isDeleted)
           VALUES ($1, $2, $3, NOW(), '{}', FALSE, $4, $4, $4, FALSE, NULL, NOW(), FALSE)"#,
    )
    .bind(user_id)
    .bind(multi_user.as_str())
    .bind(SAMPLE_ORGANIZATION_ID)
    .bind(user.is_admin)
    .execute(&mut **tx)
    .await?;
    // userExperiencesDAO.updateExperiencesForUser(user, Map("sampleExp" -> 10))
    sqlx::query("DELETE FROM webknossos.user_experiences WHERE _user = $1")
        .bind(user_id)
        .execute(&mut **tx)
        .await?;
    sqlx::query(
        "INSERT INTO webknossos.user_experiences(_user, domain, value) VALUES ($1, 'sampleExp', 10)",
    )
    .bind(user_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO webknossos.experienceDomains(domain, _organization) VALUES ('sampleExp', $1) ON CONFLICT DO NOTHING",
    )
    .bind(SAMPLE_ORGANIZATION_ID)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "INSERT INTO webknossos.user_team_roles(_user, _team, isTeamManager) VALUES ($1, $2, $3)",
    )
    .bind(user_id)
    .bind(team)
    .bind(user.is_team_manager)
    .execute(&mut **tx)
    .await?;
    tracing::info!("Inserted default user");
    Ok(())
}

async fn insert_publications(tx: &mut sqlx::Transaction<'_, sqlx::Postgres>) -> ApiResult<()> {
    const DEFAULT_DESCRIPTION: &str = r#"Serial block-face scanning electron microscopy volume from layer 4 of mouse primary somatosensory cortex (P28).

A Motta, M Berning, KM Boergens, B Staffler, M Beining, S Loomba, P Hennig, H Wissler, M Helmstaedter\
Science. 24 October 2019. [10.1126/science.aay3134](https://doi.org/10.1126/science.aay3134)\
© Max Planck Institute for Brain Research, Frankfurt, Germany\
Data available at [https://l4dense2019.brain.mpg.de/](https://l4dense2019.brain.mpg.de/)"#;
    sqlx::query(
        r#"INSERT INTO webknossos.publications(_id, publicationDate, imageUrl, title, description, created, isDeleted)
           VALUES ($1, to_timestamp(1571875200), NULL, $2, $3, NOW(), FALSE),
                  ($4, NOW(), $5, $6, $7, NOW(), FALSE)"#,
    )
    .bind(DEFAULT_PUBLICATION_ID)
    .bind("Dense connectomic reconstruction in layer 4 of the somatosensory cortex")
    .bind(DEFAULT_DESCRIPTION)
    .bind(SINGLE_DATASET_PUBLICATION_ID)
    .bind("https://static.webknossos.org/images/icon-only.svg")
    .bind("Dummy publication with a single dataset")
    .bind("Doe, J., Roe, R. · *Nature Methods* 2025 · [DOI](https://github.com/scalableminds/webknossos)")
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Sample datasets

struct SampleDataset {
    id: &'static str,
    publication: Option<&'static str>,
    description: Option<&'static str>,
    is_public: bool,
    name: String,
    metadata: Value,
    /// The data source in datastore JSON form (layers + scale).
    source: Value,
}

fn l4_layers() -> Value {
    let mags = |layer: &str| {
        [
            ([1, 1, 1], "1"),
            ([2, 2, 1], "2-2-1"),
            ([4, 4, 1], "4-4-1"),
            ([8, 8, 2], "8-8-2"),
            ([16, 16, 4], "16-16-4"),
        ]
        .map(|(mag, suffix)| {
            json!({
                "mag": mag,
                "path": format!("https://static.webknossos.org/data/zarr_v3/l4_sample/{layer}/{suffix}"),
            })
        })
    };
    let bounding_box =
        json!({"topLeft": [3072, 3072, 512], "width": 1024, "height": 1024, "depth": 1024});
    json!([
        {"name": "color", "category": "color", "dataFormat": "zarr3", "boundingBox": bounding_box,
         "elementClass": "uint8", "mags": mags("color")},
        {"name": "segmentation", "category": "segmentation", "dataFormat": "zarr3",
         "boundingBox": bounding_box, "elementClass": "uint32", "mags": mags("segmentation"),
         "largestSegmentId": 2504697},
    ])
}

fn sample_datasets() -> Vec<SampleDataset> {
    let l4_metadata = json!([
        {"key": "species", "type": "string", "value": "mouse"},
        {"key": "acquisition", "type": "string", "value": "SBEM"},
    ]);
    let l4 = |id, directory: &str, publication, brain_region: Option<&str>| {
        let mut metadata = l4_metadata.clone();
        if let (Some(region), Value::Array(entries)) = (brain_region, &mut metadata) {
            entries.push(json!({"key": "brainRegion", "type": "string", "value": region}));
        }
        SampleDataset {
            id,
            publication: Some(publication),
            description: None,
            is_public: false,
            name: directory.to_owned(),
            metadata,
            source: json!({
                "id": {"name": directory, "team": SAMPLE_ORGANIZATION_ID},
                "dataLayers": l4_layers(),
                "scale": {"factor": [L4_VOXEL_SIZE, L4_VOXEL_SIZE, 28.0], "unit": "nanometer"},
            }),
        }
    };
    let nd_channel = |index: i32| {
        json!({
            "name": format!("channel{index}"), "category": "color", "dataFormat": "zarr",
            "boundingBox": {"topLeft": [0, 0, 0], "width": 512, "height": 512, "depth": 10},
            "elementClass": "uint8",
            "additionalAxes": [{"name": "t", "bounds": [0, 43], "index": 0}],
            "mags": [{
                "mag": [1, 1, 1],
                "axisOrder": {"x": 4, "y": 3, "z": 2, "c": 1},
                "channelIndex": index,
                "path": format!("s3://gs-public-zarr-archive/tubhiswt-4D.ome.zarr/0/{index}"),
            }],
        })
    };
    vec![
        l4(
            DEFAULT_DATASET_ID,
            "l4_sample_remote",
            DEFAULT_PUBLICATION_ID,
            None,
        ),
        l4(
            "6ac000000000000000000002",
            "l4_sample_remote_2",
            DEFAULT_PUBLICATION_ID,
            Some("Cortex L4"),
        ),
        l4(
            "6ac000000000000000000003",
            "l4_sample_remote_3",
            DEFAULT_PUBLICATION_ID,
            Some("Cortex L2/3"),
        ),
        l4(
            "6ac000000000000000000004",
            "l4_sample_remote_4",
            DEFAULT_PUBLICATION_ID,
            Some("Cortex L5"),
        ),
        l4(
            "6ac000000000000000000005",
            "l4_sample_remote_5",
            SINGLE_DATASET_PUBLICATION_ID,
            Some("Cortex L4"),
        ),
        SampleDataset {
            id: REMOTE_ND_DATASET_ID,
            publication: None,
            description: Some("Remote OME-Zarr dataset from S3"),
            is_public: true,
            name: "tubhiswt-4D OME-Zarr".into(),
            metadata: json!([
                {"key": "source", "type": "string", "value": "s3://gs-public-zarr-archive/tubhiswt-4D.ome.zarr/0"},
                {"key": "format", "type": "string", "value": "ome-zarr"},
            ]),
            source: json!({
                "id": {"name": "tubhiswt-4D", "team": SAMPLE_ORGANIZATION_ID},
                "dataLayers": [nd_channel(0), nd_channel(1)],
                "scale": {"factor": [1.0, 1.0, 1.0], "unit": "nanometer"},
            }),
        },
    ]
}

async fn insert_dataset_if_absent(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    dataset: &SampleDataset,
    data_store: &str,
    uploader: &str,
    folder: &str,
) -> ApiResult<()> {
    let present: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM webknossos.datasets_ WHERE _id = $1)")
            .bind(dataset.id)
            .fetch_one(&mut **tx)
            .await?;
    if present {
        return Ok(());
    }
    let source = dataset_source::parse_data_source(&dataset.source).map_err(|error| {
        tracing::error!(%error, "Invalid built-in sample data source");
        ApiError::internal()
    })?;
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
    .bind(&source.organization)
    .bind(dataset.publication)
    .bind(uploader)
    .bind(folder)
    .bind(dataset.description)
    .bind(&source.directory_name)
    .bind(dataset.is_public)
    .bind(&dataset.name)
    .bind(source.factor[0])
    .bind(source.factor[1])
    .bind(source.factor[2])
    .bind(&source.unit)
    .bind(&dataset.metadata)
    .execute(&mut **tx)
    .await?;
    dataset_source::write_layers(tx, dataset.id, &source.layers).await
}

/// organizationService.createOrganizationDirectory: notify every datastore;
/// individual RPC failures are ignored, as in Play.
async fn create_organization_directory(pool: &sqlx::PgPool, clients: &ServiceClients) {
    let urls: Vec<String> =
        match sqlx::query_scalar("SELECT url FROM webknossos.dataStores_ ORDER BY name")
            .fetch_all(pool)
            .await
        {
            Ok(urls) => urls,
            Err(_) => {
                tracing::warn!("Could not list datastores for organization directory creation");
                return;
            }
        };
    let query = [("organizationId", SAMPLE_ORGANIZATION_ID.to_owned())];
    let requests = urls.iter().map(|url| {
        clients.request(
            axum::http::Method::POST,
            url,
            &["data", "triggers", "createOrganizationDirectory"],
            &query,
            None,
        )
    });
    for result in futures_util::future::join_all(requests).await {
        if let Err(error) = result {
            tracing::warn!(%error, "Datastore organization directory creation failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_data_sources_parse() {
        for dataset in sample_datasets() {
            let source = dataset_source::parse_data_source(&dataset.source).unwrap();
            assert_eq!(source.organization, SAMPLE_ORGANIZATION_ID);
            assert_eq!(source.layers.len(), 2);
        }
    }
}
