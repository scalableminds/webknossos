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
mod dao;
#[cfg(test)]
use dao::{DEFAULT_WORKER_COMMANDS, DEFAULT_WORKER_ID};

use axum::{Extension, Router, extract::State, response::Response, routing::post};
use serde_json::{Value, json};

use crate::{
    AppState,
    auth::browser::onboarding::create_organization_directory,
    dataset::source::UsableDataSource,
    error::{ApiError, ApiResult},
    stores::client::ServiceClients,
    system::application_info::{LocalStoreConfig, MiscConfig, MiscState, ok_empty},
    util::id::ObjectId,
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
const DUMMY_PUBLICATION_ID: &str = "6ac000000000000000000001";
const DEFAULT_DATASET_ID: &str = "68b80290d4000090f8f4aa62";
const L4_DENSE_DATASET_ID: &str = "6ac000000000000000000006";
const REMOTE_ND_DATASET_ID: &str = "05c85a876c4c979ef53752b4";
const CUSTOM_AI_MODEL_ID: &str = "66544a56d20000af0e42ba0f";
/// AiModelService.pretrained*ModelId
pub const PRETRAINED_AI_MODEL_IDS: [&str; 4] = [
    "576500000000000000000001",
    "576500000000000000000002",
    "576500000000000000000003",
    "576500000000000000000004",
];
const L4_DENSE_DESCRIPTION: &str = "Dense connectomic reconstruction in layer 4 of mouse somatosensory cortex.\n\nA Motta, M Berning, KM Boergens, B Staffler, M Beining, S Loomba, P Hennig, H Wissler, M Helmstaedter\\\nScience. 24 October 2019. [10.1126/science.aay3134](https://doi.org/10.1126/science.aay3134)\n\nSegmentation by [scalable minds](https://home.webknossos.org/services/automated-segmentation).";
const L4_VOXEL_SIZE: f64 = 11.239999771118164;

pub fn router() -> Router<AppState> {
    Router::new().route("/triggers/initialData", post(trigger_insert))
}

async fn trigger_insert(
    State(state): State<AppState>,
    State(misc): State<MiscState>,
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
            dao::insert_ai_model_if_absent(pool, &model).await?;
        }
    }
    // Everything below only runs in the dev setup.
    if !config.sample_organization.enabled {
        return Err(ApiError::bad_request(INITIAL_DATA_NOT_ENABLED));
    }
    if config.jobs_enabled
        && let Some(store) = &config.local_datastore
    {
        dao::upsert_default_worker(pool, &store.name).await?;
    }
    insert_sample_organization(&state, config).await?;
    if let Some(Extension(clients)) = clients {
        create_organization_directory(pool, Some(&clients), SAMPLE_ORGANIZATION_ID).await;
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
    let existing = dao::find_local_store(pool, table, url).await?;
    match existing {
        Some((name, public_url)) => {
            if public_url != store.public_uri {
                dao::update_local_store_urls(pool, table, store, url, name).await?;
            }
        }
        None => {
            tracing::info!(table, "Inserting local store");
            dao::insert_local_store(pool, table, store, url).await?;
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
    user: Option<ObjectId>,
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
    let first_hash = crate::auth::browser::hash_password(sample.password.clone()).await?;
    let second_hash = crate::auth::browser::hash_password(sample.password.clone()).await?;

    let mut tx = state.pool.begin().await?;
    // Serialize concurrent triggers so only one passes the emptiness check.
    dao::lock_initial_data(&mut tx).await?;
    let organizations_present = dao::are_organizations_present(&mut tx).await?;
    if organizations_present {
        return Err(ApiError::bad_request(ORGANIZATIONS_PRESENT));
    }

    let organization = SAMPLE_ORGANIZATION_ID;
    let root_folder = ObjectId::new();
    let team = ObjectId::new();
    let user_id = ObjectId::new();

    dao::insert_root_folder(&mut tx, &root_folder, ROOT_FOLDER_NAME).await?;
    dao::insert_root_folder_path(&mut tx, &root_folder).await?;
    dao::insert_sample_organization(
        &mut tx,
        organization,
        SAMPLE_ORGANIZATION_INFORMATION,
        SAMPLE_ORGANIZATION_NAME,
        &root_folder,
    )
    .await?;
    let teams_present = dao::are_teams_present(&mut tx).await?;
    if !teams_present {
        dao::insert_default_team(&mut tx, &team, organization).await?;
    }

    let users = [
        (
            user_id.clone(),
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
            ObjectId::new(),
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
        insert_default_user(&mut tx, id, user, &team).await?;
    }

    // insertToken: one Authentication token for the default user.
    let token_present = dao::is_authentication_token_present(&mut tx, &user_id).await?;
    if !token_present {
        let expiry_millis = i64::try_from(config.authenticator_expiry.as_millis())
            .map_err(|_| ApiError::internal())?;
        dao::insert_authentication_token(&mut tx, &sample.token, &user_id, expiry_millis).await?;
    }

    let task_types_present = dao::are_task_types_present(&mut tx).await?;
    if !task_types_present {
        dao::insert_sample_task_type(&mut tx, SAMPLE_TASK_TYPE_ID, organization, &team).await?;
    }

    let projects_present = dao::are_projects_present(&mut tx).await?;
    if !projects_present {
        let owner = user_for_email(&mut tx, &sample.email)
            .await?
            .ok_or_else(|| ApiError::not_found(crate::msg::user::UNKNOWN))?;
        dao::insert_sample_project(&mut tx, organization, &team, owner).await?;
    }

    let publications_present = dao::are_publications_present(&mut tx).await?;
    if !publications_present {
        dao::insert_sample_publications(&mut tx).await?;
    }

    if let Some(store) = &config.local_datastore {
        for dataset in sample_datasets() {
            insert_dataset_if_absent(&mut tx, &dataset, &store.name, &user_id, &root_folder)
                .await?;
        }
        dao::insert_ai_model_if_absent(
            &mut *tx,
            &AiModel {
                id: CUSTOM_AI_MODEL_ID,
                organization: Some(organization.to_owned()),
                data_store: store.name.clone(),
                user: Some(user_id.clone()),
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
    dao::find_user_id_by_multi_user_email(tx, email).await
}

async fn insert_default_user(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    user_id: &ObjectId,
    user: &SampleUser<'_>,
    team: &ObjectId,
) -> ApiResult<()> {
    if user_for_email(tx, user.email).await?.is_some() {
        return Ok(());
    }
    let multi_user = ObjectId::new();
    dao::insert_multi_user(tx, &multi_user, user).await?;
    dao::insert_sample_user(tx, user_id, &multi_user, user.is_admin).await?;
    // userExperiencesDAO.updateExperiencesForUser(user, Map("sampleExp" -> 10))
    dao::delete_user_experiences(tx, user_id).await?;
    dao::insert_sample_experience(tx, user_id).await?;
    dao::insert_sample_experience_domain(tx).await?;
    dao::insert_user_team_role(tx, user_id, team, user.is_team_manager).await?;
    tracing::info!("Inserted default user");
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

/// Full remote l4dense dataset (Motta et al. 2019) with predictions and the
/// segmentation attachments.
fn l4_dense_dataset(metadata: Value) -> SampleDataset {
    const BASE_URL: &str = "https://static.webknossos.org/data/l4dense_motta_et_al_demo";
    let mags = |layer: &str| {
        let mut mag_list = vec![[1, 1, 1], [2, 2, 1]];
        mag_list.extend((2..=10).map(|i| [1 << i, 1 << i, 1 << (i - 1)]));
        mag_list
            .into_iter()
            .map(|mag| {
                let path = if mag == [1, 1, 1] {
                    "1".to_owned()
                } else {
                    format!("{}-{}-{}", mag[0], mag[1], mag[2])
                };
                json!({
                    "mag": mag,
                    "path": format!("{BASE_URL}/{layer}/{path}"),
                    "axisOrder": {"x": 1, "y": 2, "z": 3, "c": 0},
                })
            })
            .collect::<Vec<_>>()
    };
    let attachment = |name: &str, sub_path: &str| {
        json!({
            "name": name,
            "path": format!("{BASE_URL}/segmentation/{sub_path}/{name}"),
            "dataFormat": "zarr3",
        })
    };
    let agglomerates: Vec<Value> = (5..=100)
        .step_by(5)
        .map(|i| attachment(&format!("agglomerate_view_{i}"), "agglomerates"))
        .collect();
    let bounding_box =
        json!({"topLeft": [128, 128, 128], "width": 5445, "height": 8380, "depth": 3285});
    SampleDataset {
        id: L4_DENSE_DATASET_ID,
        publication: Some(DEFAULT_PUBLICATION_ID),
        description: Some(L4_DENSE_DESCRIPTION),
        is_public: false,
        name: "L4 Dense Connectome (Motta et al. 2019)".into(),
        metadata,
        source: json!({
            "id": {"name": "l4dense_motta_et_al_demo", "team": SAMPLE_ORGANIZATION_ID},
            "dataLayers": [
                {"name": "color", "category": "color", "dataFormat": "zarr3",
                 "boundingBox": bounding_box, "elementClass": "uint8", "mags": mags("color")},
                {"name": "predictions", "category": "color", "dataFormat": "zarr3",
                 "boundingBox": {"topLeft": [0, 0, 0], "width": 5632, "height": 8704, "depth": 3584},
                 "elementClass": "uint24", "mags": mags("predictions")},
                {"name": "segmentation", "category": "segmentation", "dataFormat": "zarr3",
                 "boundingBox": bounding_box, "elementClass": "uint32", "mags": mags("segmentation"),
                 "attachments": {
                     "meshes": [attachment("meshfile_4-4-2", "meshes")],
                     "agglomerates": agglomerates,
                     "segmentIndex": attachment("segmentIndex", "segmentIndex"),
                     "connectomes": [attachment("paper_l4_full_connectome", "connectomes")],
                 },
                 "largestSegmentId": 2504697},
            ],
            "scale": {"factor": [11.24, 11.24, 28.0], "unit": "nanometer"},
        }),
    }
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
            publication,
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
        l4(DEFAULT_DATASET_ID, "l4_sample_remote", None, None),
        l4(
            "6ac000000000000000000002",
            "l4_sample_remote_2",
            Some(DUMMY_PUBLICATION_ID),
            Some("Cortex L4"),
        ),
        l4(
            "6ac000000000000000000003",
            "l4_sample_remote_3",
            Some(DUMMY_PUBLICATION_ID),
            Some("Cortex L2/3"),
        ),
        l4(
            "6ac000000000000000000004",
            "l4_sample_remote_4",
            Some(DUMMY_PUBLICATION_ID),
            Some("Cortex L5"),
        ),
        l4(
            "6ac000000000000000000005",
            "l4_sample_remote_5",
            Some(DUMMY_PUBLICATION_ID),
            Some("Cortex L4"),
        ),
        l4_dense_dataset(l4_metadata),
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
    uploader: &ObjectId,
    folder: &ObjectId,
) -> ApiResult<()> {
    let present = dao::is_dataset_present(tx, dataset.id).await?;
    if present {
        return Ok(());
    }
    let source = UsableDataSource::from_json(&dataset.source).map_err(|error| {
        tracing::error!(%error, "Invalid built-in sample data source");
        ApiError::internal()
    })?;
    dao::insert_sample_dataset(tx, dataset, &source, data_store, uploader, folder).await?;
    crate::dataset::source::write_layers(tx, &ObjectId::parse(dataset.id)?, &source.data_layers)
        .await
}

#[cfg(test)]
mod tests;
