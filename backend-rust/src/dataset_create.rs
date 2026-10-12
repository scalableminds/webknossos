//! DatasetService.createDataset / createAndSetUpDataset and the validation
//! helpers shared by upload-to-paths, compose, explore+add and duplication.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde_json::{Value, json};

use crate::{
    auth::AuthUser,
    dataset_lifecycle,
    dataset_source::{self, Category, DataSource},
    error::{ApiError, ApiResult},
    id::ObjectId,
    service_clients::ServiceClients,
};

const REPLACEMENTS: &[(char, &str)] = &[
    ('ü', "ue"),
    ('Ü', "Ue"),
    ('ö', "oe"),
    ('Ö', "Oe"),
    ('ä', "ae"),
    ('Ä', "Ae"),
    ('ß', "ss"),
    ('é', "e"),
    ('è', "e"),
    ('ê', "e"),
    ('È', "E"),
    ('É', "E"),
    ('Ê', "E"),
    ('Ç', "C"),
    ('ç', "c"),
    ('ñ', "n"),
    ('Ñ', "N"),
    ('ë', "e"),
    ('Ë', "E"),
    ('ï', "i"),
    ('Ï', "I"),
    ('å', "a"),
    ('Å', "A"),
    ('œ', "oe"),
    ('Œ', "Oe"),
    ('æ', "ae"),
    ('Æ', "Ae"),
    ('þ', "th"),
    ('Þ', "Th"),
    ('ø', "oe"),
    ('Ø', "Oe"),
    ('í', "i"),
    ('ì', "i"),
];

/// TextUtils.normalizeStrong: transliterate, then keep [A-Za-z0-9_-] and Java `\s`.
pub(crate) fn normalize_strong(text: &str) -> Option<String> {
    let mut result = String::new();
    for c in text.chars() {
        match REPLACEMENTS.iter().find(|(from, _)| *from == c) {
            Some((_, to)) => result.push_str(to),
            None => result.push(c),
        }
    }
    let kept: String = result
        .chars()
        .filter(|c| {
            c.is_ascii_alphanumeric()
                || matches!(
                    c,
                    '_' | '-' | ' ' | '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r'
                )
        })
        .collect();
    (!kept.is_empty()).then_some(kept)
}

pub(crate) fn generate_directory_name(name: &str, id: &str) -> String {
    match normalize_strong(name) {
        Some(prefix) => format!("{prefix}-{id}"),
        None => id.to_owned(),
    }
}

/// RandomIDGenerator.generateBlocking: URL-safe base64 without padding.
pub(crate) fn random_id(bytes: usize) -> ApiResult<String> {
    let mut random = vec![0_u8; bytes];
    getrandom::fill(&mut random).map_err(|_| ApiError::internal())?;
    Ok(URL_SAFE_NO_PAD.encode(random))
}

/// DatasetService.assertValidDatasetName.
pub(crate) fn validate_dataset_name(name: &str) -> ApiResult<()> {
    if !name
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || b"_-.".contains(&c))
    {
        return Err(ApiError::bad_request(
            "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens.",
        ));
    }
    if name.starts_with('.') {
        return Err(ApiError::bad_request(
            "Dataset name is invalid. Please use a name that does not start with a dot.",
        ));
    }
    if name.chars().count() < 3 {
        return Err(ApiError::bad_request(
            "Dataset name is invalid. Please use at least three characters.",
        ));
    }
    Ok(())
}

/// DatasetService.assertValidLayerNameLax.
pub(crate) fn validate_layer_name_lax(name: &str) -> ApiResult<()> {
    if name.contains('/') {
        return Err(ApiError::bad_request(
            "Layer name contains invalid characters.",
        ));
    }
    if name.starts_with('.') {
        return Err(ApiError::bad_request(
            "Layer name must not start with a dot.",
        ));
    }
    Ok(())
}

fn largest_segment_id_in_range(id: Option<i64>, element_class: &str) -> bool {
    let max: Option<i64> = match element_class {
        "uint8" => Some(i64::from(u8::MAX)),
        "int8" => Some(i64::from(i8::MAX)),
        "uint16" => Some(i64::from(u16::MAX)),
        "int16" => Some(i64::from(i16::MAX)),
        "uint32" => Some(i64::from(u32::MAX)),
        "int32" => Some(i64::from(i32::MAX)),
        "int64" => Some(i64::MAX),
        // Every bit pattern is a valid non-negative uint64 value.
        "uint64" => return true,
        _ => return false,
    };
    id.is_none_or(|id| id >= 0 && max.is_none_or(|max| id <= max))
}

/// DataSourceValidation.validateDataSourceGetErrors.
pub(crate) fn data_source_errors(source: &DataSource) -> Vec<&'static str> {
    let mut errors = Vec::new();
    let mut check = |ok: bool, message: &'static str| {
        if !ok {
            errors.push(message);
        }
    };
    let sorted: Vec<Vec<[i32; 3]>> = source
        .layers
        .iter()
        .map(|layer| {
            let mut mags: Vec<[i32; 3]> = layer.mags.iter().map(|m| m.mag).collect();
            mags.sort_by_key(|m| m[0].max(m[1]).max(m[2]));
            mags
        })
        .collect();
    let monotonic = (0..3).all(|axis| {
        sorted
            .iter()
            .all(|mags| mags.windows(2).all(|w| w[0][axis] <= w[1][axis]))
    });
    check(
        source.factor.iter().all(|f| *f > 0.0),
        "Voxel size (scale) is negative in at least one dimension.",
    );
    check(
        monotonic,
        "Mags do not monotonically increase in all dimensions.",
    );
    check(
        sorted.iter().all(|mags| {
            let mut seen = std::collections::HashSet::new();
            mags.iter().all(|m| seen.insert(*m))
        }),
        "There are duplicate mags in a layer.",
    );
    check(!source.layers.is_empty(), "No layers.");
    check(
        source
            .layers
            .iter()
            .all(|l| l.bounding_box[3] > 0 && l.bounding_box[4] > 0 && l.bounding_box[5] > 0),
        "Empty bounding box in a layer.",
    );
    let segmentation = source
        .layers
        .iter()
        .filter(|l| l.category == Category::Segmentation);
    check(
        segmentation.clone().all(|l| {
            matches!(
                l.element_class.as_str(),
                "uint8" | "uint16" | "uint32" | "uint64" | "int8" | "int16" | "int32" | "int64"
            )
        }),
        "Invalid element class for a segmentation layer.",
    );
    check(
        segmentation
            .clone()
            .all(|l| largest_segment_id_in_range(l.largest_segment_id, &l.element_class)),
        "Largest segment id exceeds range (must be nonnegative and within the element class's value range).",
    );
    let mut names = std::collections::HashSet::new();
    check(
        source.layers.iter().all(|l| names.insert(l.name.as_str())),
        "Layer names must be unique. At least two layers have the same name.",
    );
    check(
        source.layers.iter().all(|l| !l.name.contains('/')),
        "Layer names must not contain forward slash.",
    );
    check(
        source.layers.iter().all(|l| !l.name.starts_with('.')),
        "Layer names must not start with dot.",
    );
    check(
        source.layers.iter().all(|l| {
            l.attachments
                .as_ref()
                .is_none_or(|a| !a.contains_duplicate_names())
        }),
        "Layer attachments must have unique names in their respective category.",
    );
    errors
}

pub(crate) fn assert_valid_data_source(source: &DataSource) -> ApiResult<()> {
    if data_source_errors(source).is_empty() {
        Ok(())
    } else {
        Err(ApiError::bad_request("DataSource is invalid"))
    }
}

/// FolderDAO update access: organization admins/dataset managers, or team
/// managers of a team allowed on the folder or one of its ancestors.
pub(crate) async fn folder_writable(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    folder: &str,
) -> ApiResult<bool> {
    Ok(sqlx::query_scalar(
        r#"SELECT EXISTS (SELECT 1 FROM webknossos.folders_ f WHERE f._id = $1 AND (
             f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
               SELECT o._rootFolder FROM webknossos.organizations_ o JOIN webknossos.users_ u ON u._organization = o._id
               WHERE u._id = $2 AND (u.isAdmin OR u.isDatasetManager)))
             OR f._id IN (SELECT fp._descendant FROM webknossos.folder_paths fp WHERE fp._ancestor IN (
               SELECT at._folder FROM webknossos.folder_allowedTeams at JOIN webknossos.user_team_roles tr ON at._team = tr._team
               WHERE tr._user = $2 AND tr.isTeamManager))))"#,
    )
    .bind(folder)
    .bind(&user.id)
    .fetch_one(&mut *connection)
    .await?)
}

pub(crate) struct NewDataset<'a> {
    pub id: &'a str,
    pub store_name: &'a str,
    pub name: &'a str,
    pub source: &'a DataSource,
    pub is_usable: bool,
    /// None keeps the voxel size unset (unusable data sources).
    pub voxel_size: Option<([f64; 3], &'a str)>,
    pub status: &'a str,
    pub is_virtual: bool,
    pub metadata: Value,
    pub description: Option<&'a str>,
    pub creation_type: &'a str,
    pub import_url: Option<&'a str>,
}

/// DatasetService.createDataset (database part): the dataset starts in the
/// root folder of the data source's organization, private, without teams.
pub(crate) async fn insert_dataset(
    connection: &mut sqlx::PgConnection,
    new: NewDataset<'_>,
) -> ApiResult<()> {
    let root: Option<String> = sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(&new.source.organization)
    .fetch_optional(&mut *connection)
    .await?;
    let root = root.ok_or_else(|| {
        ApiError::bad_request(format!(
            "Organization “{}” could not be found or accessed.",
            new.source.organization
        ))
    })?;
    let status: String = new.status.chars().take(1024).collect();
    sqlx::query(
        r#"INSERT INTO webknossos.datasets (_id, _dataStore, _organization, _folder, inboxSourceHash,
             defaultViewConfiguration, description, directoryName, isPublic, isUsable, isVirtual, name,
             voxelSizeFactor, voxelSizeUnit, status, sortingKey, metadata, tags, creationType, importURL, created)
           VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, false, $8, $9, $10,
             CASE WHEN $11::float8 IS NULL THEN NULL ELSE ROW($11, $12, $13)::webknossos.VECTOR3 END,
             $14::webknossos.LENGTH_UNIT, $15, NOW(), $16, '{}',
             $17::webknossos.DATASET_CREATION_TYPE, $18, NOW())"#,
    )
    .bind(new.id)
    .bind(new.store_name)
    .bind(&new.source.organization)
    .bind(&root)
    .bind(new.source.default_view_configuration.clone().map(Value::Object))
    .bind(new.description)
    .bind(&new.source.directory_name)
    .bind(new.is_usable)
    .bind(new.is_virtual)
    .bind(new.name)
    .bind(new.voxel_size.map(|v| v.0[0]))
    .bind(new.voxel_size.map(|v| v.0[1]))
    .bind(new.voxel_size.map(|v| v.0[2]))
    .bind(new.voxel_size.map(|v| v.1))
    .bind(status)
    .bind(new.metadata)
    .bind(new.creation_type)
    .bind(new.import_url)
    .execute(&mut *connection)
    .await?;
    dataset_source::write_layers(connection, new.id, &new.source.layers).await
}

/// DatasetService.createAndSetUpDataset (database part, in the caller's
/// transaction): validate the name, require folder write access, create the
/// dataset in the folder (fallback root) and record the uploader.
pub(crate) struct SetUp<'a> {
    pub name: &'a str,
    pub store_name: &'a str,
    pub source: &'a DataSource,
    pub folder: Option<&'a str>,
    pub creation_type: &'a str,
    pub import_url: Option<&'a str>,
}

pub(crate) async fn set_up_dataset(
    connection: &mut sqlx::PgConnection,
    user: &AuthUser,
    setup: SetUp<'_>,
) -> ApiResult<String> {
    validate_dataset_name(setup.name)?;
    let root: String = sqlx::query_scalar(
        "SELECT _rootFolder FROM webknossos.organizations_ WHERE _id = $1 FOR SHARE",
    )
    .bind(&user.organization_id)
    .fetch_optional(&mut *connection)
    .await?
    .ok_or_else(|| {
        ApiError::bad_request(format!(
            "Organization “{}” could not be found or accessed.",
            user.organization_id
        ))
    })?;
    let folder = setup.folder.map(str::to_owned).unwrap_or(root);
    if !folder_writable(connection, user, &folder).await? {
        return Err(ApiError::bad_request("No write access in this folder."));
    }
    let id = ObjectId::new().to_string();
    let mut source = setup.source.clone();
    source.directory_name = generate_directory_name(setup.name, &id);
    source.organization = user.organization_id.clone();
    insert_dataset(
        connection,
        NewDataset {
            id: &id,
            store_name: setup.store_name,
            name: setup.name,
            source: &source,
            is_usable: true,
            voxel_size: Some((source.factor, &source.unit)),
            status: source.status_opt.as_deref().unwrap_or(""),
            is_virtual: true,
            metadata: json!([]),
            description: None,
            creation_type: setup.creation_type,
            import_url: setup.import_url,
        },
    )
    .await?;
    sqlx::query("UPDATE webknossos.datasets SET _folder = $2, _uploader = $3 WHERE _id = $1")
        .bind(&id)
        .bind(&folder)
        .bind(&user.id)
        .execute(&mut *connection)
        .await?;
    Ok(id)
}

/// The datastore side effects of createDataset, run after the commit.
pub(crate) async fn after_create(
    pool: &sqlx::PgPool,
    clients: &ServiceClients,
    id: &str,
) -> ApiResult<()> {
    let record = dataset_lifecycle::load_record(pool, id)
        .await?
        .ok_or_else(ApiError::internal)?;
    dataset_lifecycle::scan_realpaths_if_virtual(pool, clients, &record).await?;
    dataset_lifecycle::write_mirror_for_virtual(pool, clients, &record).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn directory_names_follow_text_utils() {
        assert_eq!(
            generate_directory_name("Größe test/1", "abc"),
            "Groesse test1-abc"
        );
        assert_eq!(generate_directory_name("§$%", "abc"), "abc");
        assert!(validate_dataset_name("ok_name-1.x").is_ok());
        assert!(validate_dataset_name(".hidden").is_err());
        assert!(validate_dataset_name("ab").is_err());
        assert!(validate_dataset_name("with space").is_err());
        assert_eq!(random_id(12).unwrap().len(), 16);
    }
}
