//! User-facing messages from Play's catalog (`util/src/main/scala/com/scalableminds/util/Msg.scala`).
//!
//! The frontend shows these texts verbatim in toasts, so they are copied exactly, including the
//! typographic quotes. Names follow the Scala objects (`Msg.Project.notFound(id)` →
//! `msg::project::not_found(id)`). Add entries here instead of inventing new wording at call sites.
//! Entries marked *Rust-only* have no Play counterpart (request extraction, stricter checks).

pub const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
pub const NOT_FOUND: &str = "Could not find or access the requested resource.";
pub const SHORT_LINK_NOT_FOUND: &str = "No shortlink with this key could be found.";
/// Rust-only wording.
pub const NOT_ALLOWED_SHORT: &str = "Not allowed.";
pub const PUBLICATION_NOT_FOUND: &str = "Publication could not be found.";

/// Rust-only: request extraction and generic database failures.
pub mod request {
    use std::fmt::Display;

    pub const INVALID_JSON_BODY: &str = "Invalid JSON request body.";
    pub const INVALID_QUERY: &str = "Invalid query parameters.";
    pub const INVALID_PATH: &str = "Invalid path parameters.";
    pub const INVALID_PAGINATION: &str = "Invalid pagination.";
    pub const INVALID_TIMESTAMP: &str = "Invalid timestamp.";
    pub const RESOURCE_NOT_FOUND: &str = "Resource not found.";
    pub const INVALID_RESOURCE_VALUES: &str = "Invalid resource values.";
    pub const DATABASE_UNAVAILABLE: &str = "Database unavailable.";
    pub const SERVICE_INVALID_JSON: &str = "Service returned an invalid JSON response.";
    /// Play's query binder for a missing parameter.
    pub fn missing_parameter(name: impl Display) -> String {
        format!("Missing parameter: {name}")
    }
    /// Rust-only: an invalid query parameter value.
    pub fn invalid_parameter(name: impl Display) -> String {
        format!("Invalid parameter: {name}")
    }
    /// Play's `SQLDAO` when a listed row does not parse.
    pub fn list_row_parse_failed(table: impl Display) -> String {
        format!("Parsing failed for a row in {table} during list query")
    }
    /// Play's query binder for an invalid Boolean parameter.
    pub fn invalid_boolean(name: impl Display) -> String {
        format!("Cannot parse parameter {name} as Boolean: should be true, false, 0 or 1")
    }
    /// Play's query binder for an invalid Long parameter.
    pub fn invalid_long(name: impl Display, value: impl Display) -> String {
        format!("Cannot parse parameter {name} as Long: For input string: \"{value}\"")
    }
    pub const INVALID_STORAGE_PATH: &str = "Invalid path.";
    pub const INVALID_BODY: &str = "Invalid request body.";
    pub const INVALID_FORM_BODY: &str = "Invalid form request body.";
    pub const INVALID_LIMIT: &str = "Invalid limit.";
    pub const DATABASE_SCHEMA_INCOMPATIBLE: &str = "Database schema unavailable or incompatible.";
    /// Play's body parser.
    pub const ENTITY_TOO_LARGE: &str = "Request Entity Too Large";
    /// Play's JSON body parser.
    pub const EXPECTING_JSON_BODY: &str = "Expecting text/json or application/json body";
    pub const RESOURCE_ID_REQUIRED: &str = "Resource identifier is required.";
    pub const TRACING_ID_REQUIRED: &str = "Tracing identifier is required.";
    pub const METHOD_NOT_ALLOWED: &str = "Method not allowed.";
    pub const TIMED_OUT: &str = "Request timed out.";
    pub const ROUTE_NOT_IMPLEMENTED: &str = "Route not implemented by the Rust backend.";
}

pub mod object_id {
    use std::fmt::Display;

    pub fn invalid(literal: impl Display) -> String {
        format!("The supplied resource id “{literal}” is not a valid ObjectId.")
    }
    /// Rust-only wording.
    pub const INVALID_FORMAT: &str = "Invalid ObjectId: expected 24 hexadecimal characters.";
}

pub mod project {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Project “{id}” could not be found or accessed.")
    }
    pub fn not_found_by_name(name: impl Display) -> String {
        format!("Project with name “{name}” could not be found or accessed.")
    }
    pub const DELETE_SUCCESS: &str = "Project was successfully deleted.";
    pub fn name_taken(name: impl Display) -> String {
        format!("A project named “{name}” already exists. Please choose a different name.")
    }
    pub const NAME_TOO_SHORT: &str = "Project name must be at least three characters long.";
    pub fn name_invalid_chars(name: impl Display) -> String {
        format!(
            "Project name “{name}” contains invalid characters. Please use only letters and numbers."
        )
    }
    pub const CREATE_FAILED: &str = "Could not create project.";
    pub const INCREASE_TASK_INSTANCES_NEGATIVE: &str =
        "Cannot increment task counts by a negative number.";
    pub const DELETE_NOT_ALLOWED: &str =
        "You do not have permission to delete this project. Please ask the project owner.";
    pub const UPDATE_FAILED: &str = "Could not update project.";
}

pub mod task_type {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Task type “{id}” could not be found or accessed.")
    }
    pub fn summary_taken(summary: impl Display) -> String {
        format!(
            "A task type with summary “{summary}” already exists. Please choose a different name."
        )
    }
    pub const SUMMARY_TOO_SHORT: &str = "Task type summary must be at least two characters long.";
    pub const SUMMARY_TOO_LONG: &str = "Task type summary must be at most 50 characters long.";
    pub const EDIT_SUCCESS: &str = "Task type was successfully updated.";
    pub fn delete_success(summary: impl Display) -> String {
        format!("Task type “{summary}” was successfully deleted.")
    }
    pub const MAG_RESTRICTIONS_IMMUTABLE: &str = "Mag restrictions of existing task types cannot be changed. Consider creating a new task type.";
    pub const TRACING_TYPE_IMMUTABLE: &str = "Annotation types of existing task types cannot be changed. Consider creating a new task type.";
    /// Play message key (not in `Msg`).
    pub const RECOMMENDED_CONFIGURATION_INVALID: &str = "taskType.recommendedConfigurationInvalid";
}

pub mod task {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Task “{id}” could not be found or accessed.")
    }
    pub const UNAVAILABLE: &str = "There is currently no task available.";
    pub const DELETE_SUCCESS: &str = "Task was successfully deleted.";
    pub const EDIT_SUCCESS: &str = "Task was successfully updated.";
    /// Rust-only wording.
    pub const MISSING: &str = "Task not found.";
}

pub mod script {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Script “{id}” could not be found or accessed.")
    }
    pub const UPDATE_ONLY_OWNER: &str =
        "You do not have permission to update this script. Please ask the script owner.";
    pub const DELETE_ONLY_OWNER: &str =
        "You do not have permission to delete this script. Please ask the script owner.";
    /// Rust-only wording.
    pub const INVALID_GIST_URL: &str = "Invalid script gist URL.";
    pub const NAME_TOO_SHORT: &str = "Script name must be at least two characters long.";
    pub const NAME_TOO_LONG: &str = "Script name must be at most 50 characters long.";
}

pub mod team {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Team “{id}” could not be found or accessed.")
    }
    pub const ADMIN_NOT_ALLOWED: &str = "You do not have permission to administrate this team.";
    pub const CREATE_ONLY_ADMIN: &str =
        "You do not have permission to create teams. Please ask an organization admin.";
    /// Rust-only wording.
    pub const INVALID_NAME: &str = "Invalid team name.";
    pub const DELETE_ONLY_ADMIN: &str =
        "You do not have permission to delete teams. Please ask an organization admin.";
    pub const DELETE_ORGANIZATION_TEAM: &str =
        "This team cannot be deleted. Each organization requires at least one base team.";
    pub const DELETE_IN_USE: &str = "Team cannot be deleted as it is referenced by at least one annotation, project or task type.";
    pub const CREATE_SUCCESS: &str = "Team was successfully created.";
    pub const DELETE_SUCCESS: &str = "Team was successfully deleted.";
}

pub mod organization {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Organization “{id}” could not be found or accessed.")
    }
    pub const LIST_FAILED: &str = "Could not retrieve list of organizations.";
    pub const NOT_FOUND_BY_INVITE: &str =
        "Organization specified in the invite could not be found.";

    pub mod terms_of_service {
        use std::fmt::Display;

        pub fn version_mismatch(required_version: impl Display, version: impl Display) -> String {
            format!(
                "Terms of service version mismatch. Current version is {required_version}, received acceptance for {version}."
            )
        }
    }
    /// Rust-only wording.
    pub const TEAM_MISSING: &str = "Could not find the organization team.";
    /// Rust-only wording.
    pub const MISSING: &str = "Organization not found.";
    pub const LIST_CREDIT_TRANSACTIONS_ONLY_ADMIN: &str =
        "Only organization admins can list credit transactions.";
}

pub mod data_store {
    pub const NOT_FOUND: &str = "Data store could not be found or accessed.";
    pub const AMBIGUOUS: &str = "Can only link layers of datasets from the same data store.";
    pub const UPLOAD_TO_PATHS_NOT_ALLOWED: &str = "The data store that holds the layers requested to be linked does not support dataset upload to paths.";
}

pub mod tracing_store {
    pub const NOT_FOUND: &str = "Tracing store could not be found or accessed.";
    /// Rust-only wording.
    pub const MISSING: &str = "Tracing store not found.";
}

pub mod user {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("User “{id}” could not be found or accessed.")
    }
    /// Rust-only: `not_found` without the ID.
    pub const NOT_FOUND_NO_ID: &str = "User could not be found or accessed.";
    /// Rust-only wording.
    pub const MISSING: &str = "User not found.";
    pub const NOT_AUTHENTICATED: &str =
        "You are not authorized to view this resource. Please log in.";
    pub const INVALID_CREDENTIALS: &str = "Incorrect email or password. Please try again.";
    pub const SUPER_USER_ONLY: &str = "This feature is currently only available for superusers.";
    /// Rust-only wording.
    pub const SUPER_USER_ROUTE_ONLY: &str = "This route is only allowed for super users.";

    pub mod email {
        pub const TAKEN: &str = "An account with this email address already exists. Please log in instead or use a different email.";
    }

    pub mod token {
        pub const INVALID: &str = "The supplied token is invalid or expired.";
    }
    /// Rust-only wording.
    pub const BROWSER_SESSIONS_NOT_CONFIGURED: &str =
        "Browser sessions are not configured on this server (WK_COOKIE_SIGNER_SECRET).";
    /// Rust-only wording.
    pub const UNKNOWN: &str = "User could not be found.";
    /// Rust-only wording.
    pub const NOT_EDITABLE: &str = "User is not editable by the requesting user.";
    /// Rust-only wording.
    pub const NO_LONGER_EDITABLE: &str = "User is no longer editable by the requesting user.";

    pub mod configuration {
        pub const UPDATE_SUCCESS_FOR_DATASET: &str =
            "Dataset configuration was successfully updated.";
        pub const UPDATE_SUCCESS: &str = "Your configuration was successfully updated.";
        pub const UPDATED_KEYBOARD_SHORTCUTS_CONFIG: &str =
            "Keyboard shortcuts configuration was successfully updated.";
    }

    pub mod invite {
        /// Play: `AuthenticationController` (not in `Msg`).
        pub const TEAMS_NOT_MANAGED: &str =
            "Can only send invites with team roles for teams you manage.";
        /// Play: `AuthenticationController` (not in `Msg`).
        pub const PROMOTION_ADMIN_ONLY: &str =
            "Only admins can send invites that promote new users to admin or dataset manager.";
    }
}

pub mod passkeys {
    pub const NOT_ENABLED: &str = "Passkeys are not enabled for this WEBKNOSSOS instance.";
    pub const REQUIRES_HTTPS: &str = "Passkeys are only supported with HTTPS.";
    /// Play: `AuthenticationController` (not in `Msg`).
    pub const LIST_FAILED: &str = "Failed to fetch Passkeys";
    /// Play: `AuthenticationController` (not in `Msg`).
    pub const ADD_FAILED: &str = "Failed to add Passkey";
}

pub mod folder {
    pub const NO_WRITE_ACCESS: &str = "No write access in this folder.";
    /// Rust-only: stricter than Play, which does not check the folder's organization.
    pub const NOT_IN_DATASET_ORGANIZATION: &str =
        "Folder does not belong to the dataset organization.";
    pub const UPDATE_NOT_ALLOWED: &str = "No write access on this folder.";
    pub const MOVE_ROOT: &str = "Cannot move the organization’s root folder.";
    pub const MOVE_SELF: &str = "Cannot move a folder into itself.";
    /// Rust-only wording.
    pub const MOVE_INTO_DESCENDANT: &str = "Cannot move a folder into one of its descendants.";
    pub const DELETE_ROOT: &str = "Cannot delete the organization’s root folder.";
    pub const DELETE_NOT_EMPTY_CHILDREN: &str =
        "Cannot delete folders that still contain other folders.";
    pub const DELETE_NOT_EMPTY_DATASETS: &str =
        "Cannot delete folders that still contain datasets.";
    pub const NAME_MUST_NOT_CONTAIN_SLASH: &str = "Folder names cannot contain forward slashes.";
}

pub mod dataset {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Dataset “{id}” could not be found or accessed.")
    }
    pub fn not_found_by_name(name: impl Display) -> String {
        format!("Dataset with name “{name}” could not be found or accessed.")
    }
    pub fn not_found_consider_login(id: impl Display) -> String {
        format!("Dataset “{id}” could not be found or accessed. You may need to log in to see it.")
    }
    pub fn not_found_for_annotation(
        dataset_id: impl Display,
        annotation_id: impl Display,
    ) -> String {
        format!(
            "Dataset “{dataset_id}” for annotation “{annotation_id}” does not exist or could not be accessed."
        )
    }
    /// Rust-only wording.
    pub const MISSING: &str = "Dataset not found.";
    pub fn not_usable(id: impl Display) -> String {
        format!("Dataset “{id}” is not imported or incomplete.")
    }
    pub const NO_LAYERS: &str = "Dataset has no data layers.";
    pub const NO_MAGS: &str = "Data layer does not contain any mags.";

    pub mod name {
        use std::fmt::Display;

        pub const INVALID_CHARACTERS: &str =
            "Dataset name is invalid. Please use only letters, digits, dots, underscores, hyphens.";
        pub const INVALID_STARTS_WITH_DOT: &str =
            "Dataset name is invalid. Please use a name that does not start with a dot.";
        pub const INVALID_LESS_THAN_THREE_CHARACTERS: &str =
            "Dataset name is invalid. Please use at least three characters.";
        pub fn taken(name: impl Display) -> String {
            format!("Dataset name “{name}” is already taken.")
        }
    }

    pub mod data_source {
        pub const NOT_FOUND: &str =
            "Data source not found on data store server. It may still be initializing.";
        pub const USABLE_BUT_NO_VOXEL_SIZE: &str =
            "Dataset is marked as usable but has no voxel size.";
        /// Play: `DataSourceValidation` (not in `Msg`).
        pub const INVALID: &str = "DataSource is invalid";
    }

    pub mod layer {
        use std::fmt::Display;

        pub fn not_found(layer_name: impl Display) -> String {
            format!("Could not find layer “{layer_name}” in dataset.")
        }
        pub const DUPLICATE_NAMES: &str = "Dataset layers must have unique names.";
        pub const ATTACHMENT_SINGLETON_ALREADY_FILLED: &str = "There is already an attachment of this type in this layer. Only one attachment of this type can be registered per layer.";
        pub const ATTACHMENT_NAME_TAKEN: &str = "An attachment with this name already exists in this layer. Please choose a different name.";
        /// Rust-only wording (the attachment counterpart of `upload::to_paths::MAG_ALREADY_PENDING`).
        pub const ATTACHMENT_ALREADY_PENDING: &str =
            "Conflict with existing pending attachment. Pass overwritePending to overwrite.";
        pub const NAME_INVALID_CHARACTERS: &str = "Layer name contains invalid characters.";
        pub const NAME_INVALID_STARTS_WITH_DOT: &str = "Layer name must not start with a dot.";
    }

    pub mod metadata {
        pub const DUPLICATE_KEYS: &str = "Metadata keys must be unique.";
        /// Rust-only wording.
        pub const ENTRIES_MUST_BE_OBJECTS: &str = "Metadata entries must be objects.";
        /// Rust-only wording.
        pub const KEYS_MUST_BE_STRINGS: &str = "Metadata keys must be strings.";
    }

    pub mod upload {
        pub const STORAGE_EXCEEDED: &str =
            "Cannot upload dataset because the storage quota of the organization is exceeded.";

        pub mod to_paths {
            pub const MAG_ALREADY_PENDING: &str =
                "Conflict with existing pending mag. Pass overwritePending to overwrite.";
            pub const MAG_NOT_PENDING: &str = "This mag is not marked as pending upload to path.";
            pub const ATTACHMENT_NOT_PENDING: &str =
                "This attachment is not marked as pending (upload to path).";
            /// Play: `UploadToPathsService` (not in `Msg`).
            pub const OTHER_UPLOADER: &str =
                "Cannot reserve paths for a dataset someone else uploaded.";
        }
        pub const NO_LAYERS: &str = "Cannot reserve upload for dataset with no layers.";
        pub const MAG_UPLOAD_ONLY_VIRTUAL: &str =
            "Adding mags to existing datasets is only allowed for virtual datasets.";
    }
    /// Play: `DatasetController` (not in `Msg`).
    pub const DUPLICATE_ONLY_VIRTUAL: &str =
        "duplicateToOrga is only possible for virtual datasets";
    /// Play: `DatasetController` (not in `Msg`).
    pub const ALREADY_USABLE: &str = "Dataset is already marked as usable.";
    /// Play: `PathDeletionController` (not in `Msg`).
    pub const PATH_DELETION_WRONG_KEY: &str = "Wrong key for external path deletion service.";
    pub const LOADING_DATA_FAILED: &str = "Could not load data for the requested dataset.";

    pub mod delete {
        pub const NOT_ENABLED: &str =
            "Dataset deletion is not enabled for this WEBKNOSSOS instance.";
        /// Rust-only wording.
        pub const ROOT_NOT_LOCAL: &str = "Cannot delete a dataset whose root path is not local.";
        pub const FAILED: &str = "Could not delete the dataset on disk.";
        /// Rust-only wording of the datastore's deletion access check.
        pub const NOT_ENABLED_FOR_DATA_STORE: &str = "Dataset deletion is not enabled.";
    }

    pub mod explore {
        pub const DATA_STORE_MUST_BE_EQUAL_FOR_ALL: &str =
            "All layers must be on the same data store for exploration.";
        pub const AUTO_ADD_GET_FOLDER_FAILED: &str =
            "Could not get or create folder during dataset exploration.";
        pub const FAILED: &str = "Could not explore remote dataset.";
        pub const AUTO_ADD_FAILED: &str = "Could not automatically import the explored dataset.";
    }

    pub mod initial_teams {
        pub const INVALID_TEAMS: &str = "Can only assign teams the requesting user is in.";
        pub const FORBIDDEN: &str = "No access to update dataset teams.";
    }

    pub mod layer_to_link {
        pub const FAILED: &str = "Could not resolve layers to link.";
    }

    pub mod mirror {
        pub const ONLY_FOR_VIRTUAL: &str =
            "Can only write on-disk dataset mirrors for virtual (db-based) datasets.";
        pub const ONLY_FOR_USABLE: &str =
            "Can only write on-disk dataset mirrors for usable datasets.";
        pub const WRITE_FAILED: &str = "Could not write on-disk dataset mirror.";
    }
}

pub mod annotation {
    pub const NOT_FOUND: &str = "Annotation could not be found or accessed.";
    /// Rust-only wording.
    pub const MISSING: &str = "Annotation not found.";
    /// Rust-only wording.
    pub const DATASET_MISSING: &str = "Annotation dataset not found.";
    /// Rust-only wording.
    pub const NO_UPDATE_ACCESS: &str = "No update access.";
    pub const FINISHED: &str = "Annotation is archived.";
    pub const TRANSFEREE_NO_DATASET_ACCESS: &str =
        "Cannot transfer annotation to a user who has no access to the dataset.";
    pub const MULTI_LAYERS_SKELETON_NOT_IMPLEMENTED: &str =
        "This feature is not implemented for annotations with more than one skeleton layer.";
    pub const MULTI_LAYERS_VOLUME_NOT_IMPLEMENTED: &str =
        "This feature is not implemented for annotations with more than one volume layer.";
    /// Rust-only wording.
    pub const EDIT_NOT_ALLOWED: &str = "You are not allowed to edit this annotation.";
    /// Play: `AnnotationSQLDAO.assertUpdateAccess` (not in `Msg`).
    pub const ASSERT_UPDATE_ACCESS_FAILED: &str = "FAILED: AnnotationSQLDAO.assertUpdateAccess";
    /// Rust-only wording.
    pub const USER_MISSING: &str = "Annotation user not found.";
    /// Rust-only wording.
    pub const SOURCE_MISSING: &str = "Annotation source not found.";
    pub const TYPES_EMPTY: &str = "No annotation types specified.";

    pub mod mutex {
        /// Rust-only wording.
        pub const INVALID_EXPIRY: &str = "Invalid annotation mutex expiry.";
    }

    pub mod private_link {
        use std::fmt::Display;

        pub fn not_found(id: impl Display) -> String {
            format!("Annotation private link “{id}” could not be found or accessed.")
        }
        pub const EXPIRED: &str = "Annotation private link token is expired.";
        /// Rust-only wording.
        pub const OWNER_ONLY: &str = "Only the annotation owner can manage its private links.";
        pub const DELETE_SUCCESS: &str = "Annotation private link was successfully deleted.";
    }
}

pub mod ai_inference {
    pub const NOT_FOUND: &str = "Could not find requested AI inference.";
}

pub mod job {
    pub const NOT_FOUND: &str = "Job could not be found or accessed.";
    pub const NOT_ENABLED: &str = "Long-running jobs are not enabled for this WEBKNOSSOS instance.";

    pub mod credits {
        pub const REFUND_FAILED: &str = "Could not perform credit transaction refund.";
    }
    pub const NOT_RUN: &str = "Job has not run yet.";
    pub const NO_EXPORT_FILE_NAME: &str = "Job does not have an export file name.";
}

pub mod voxelytics {
    pub const NOT_ENABLED: &str =
        "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";
    /// Rust-only wording.
    pub const INVALID_LOG_ENTRIES: &str = "Invalid voxelytics log entries.";
    /// Rust-only wording.
    pub const INVALID_WORKFLOW_EVENT: &str = "Invalid voxelytics workflow event.";

    pub mod loki {
        /// Rust-only wording.
        pub const REQUEST_FAILED: &str = "Loki request failed.";
        /// Rust-only wording.
        pub const TIMED_OUT: &str = "Loki request timed out.";
        /// Rust-only wording.
        pub const UNAVAILABLE: &str = "Loki is unavailable.";
        /// Play: `LokiClient` (not in `Msg`).
        pub const NOT_ENABLED: &str = "Loki is not enabled.";
        /// Play: `LokiClient` (not in `Msg`).
        pub const CONNECT_FAILED: &str = "Unexpected error while trying to connect to Loki.";
        /// Rust-only wording.
        pub const PARSE_FAILED: &str = "Could not parse the Loki log entries.";
    }
}

pub mod ai_model {
    /// Play message key from `AiModel` (not in `Msg`).
    pub const NO_ORGANIZATION: &str = "aiModel.noOrganization";
}

pub mod analytics {
    /// Play: `AnalyticsController` (not in `Msg`).
    pub const DATABASE_LOGGING_DISABLED: &str = "Database logging of events is not enabled";
    /// Play: `AnalyticsService` (not in `Msg`).
    pub const WELL_KNOWN_URIS_INVALID: &str = "wellKnownUris configuration is incorrect";
    /// Play: `AnalyticsService` (not in `Msg`).
    pub const WRONG_API_KEY: &str = "Provided API key is not correct for provided webknossosUri";
    /// Rust-only wording.
    pub const NO_EVENTS: &str = "No analytics events provided.";
}

pub mod credit_transaction {
    /// Play: `CreditTransactionController` (not in `Msg`).
    pub const MONEY_SPENT_NOT_POSITIVE: &str = "moneySpent must be a positive number";
    /// Play: `CreditTransactionController` (not in `Msg`).
    pub const CREDIT_AMOUNT_NOT_POSITIVE: &str = "creditAmount must be a positive number";
    /// Play: `CreditTransactionController` (not in `Msg`).
    pub const EXPIRATION_NOT_IN_FUTURE: &str = "Expiration date must be in the future";
    /// Rust-only wording.
    pub const CREDIT_AMOUNT_TOO_LARGE: &str = "creditAmount is too large";
    /// Rust-only wording.
    pub const NEGATIVE_BALANCE: &str =
        "Transaction would result in a negative credit balance for this organization.";
    /// Play: `CreditTransactionController` (not in `Msg`).
    pub const WRONG_ORGANIZATION: &str = "Transaction is not for this organization";
    /// Play: `CreditTransaction` (not in `Msg`).
    pub const REFUND_ONLY_PENDING: &str = "Can only refund pending transactions.";
}

pub mod oidc {
    pub const NOT_ENABLED: &str = "SSO/OIDC is not enabled for this WEBKNOSSOS instance.";
}

pub mod segment_anything {
    pub const NOT_ENABLED: &str =
        "AI-based quick select is not enabled for this WEBKNOSSOS instance.";
    pub const NO_URI: &str = "No URI for SAM server configured.";
    /// Play: `DatasetController` (not in `Msg`).
    pub const BOUNDING_BOX_TOO_DEEP: &str = "Target-mag selected bbox depth must be at most 50";
    /// Play: `DatasetController` (not in `Msg`).
    pub const MISSING_BOUNDING_BOX: &str = "Missing selectionTopLeft and selectionBottomRight parameters for bounding box interaction.";
    /// Play: `DatasetController` (not in `Msg`).
    pub const MISSING_POINT: &str = "Missing pointX and pointY parameters for point interaction.";
    pub const GET_DATA_FAILED: &str = "Could not get image data to send to SAM server.";
    /// Play: `DatasetController` (not in `Msg`).
    pub const INTENSITY_RANGE_REQUIRED: &str =
        "For float and double data, a supplied intensity range is required.";
    pub const GET_MASK_FAILED: &str = "Could not get image mask from SAM server.";
}

pub mod short_link {
    /// Rust-only wording.
    pub const INVALID_URL: &str = "Invalid short link URL.";
    /// Play: `ShortLinkController` (not in `Msg`).
    pub const URI_MISMATCH: &str = "Could not generate short link: URI does not match";
}

pub mod time_tracking {
    pub const UNSUPPORTED_ANNOTATION_TYPE: &str =
        "One of the selected annotation types is not supported for time tracking.";
}

/// Play: `NotificationEmailService` (not in `Msg`): the descriptions listed in
/// the access-changed email.
pub mod notification_email {
    use std::fmt::Display;

    /// `Annotation.nameOpt.getOrElse(...)` for annotations without a name.
    pub const UNNAMED_ANNOTATION: &str = "Unnamed annotation";
    pub const NOW_ADMIN: &str = "You are now an admin of the organization.";
    pub const NO_LONGER_ADMIN: &str = "You are no longer an admin of the organization.";
    pub const NOW_DATASET_MANAGER: &str = "You are now a dataset manager.";
    pub const NO_LONGER_DATASET_MANAGER: &str = "You are no longer a dataset manager.";
    pub fn added_to_team_as_manager(team: impl Display) -> String {
        format!("You were added to the team {team} as team manager.")
    }
    pub fn added_to_team(team: impl Display) -> String {
        format!("You were added to the team {team}.")
    }
    pub fn now_team_manager(team: impl Display) -> String {
        format!("You are now a team manager of the team {team}.")
    }
    pub fn no_longer_team_manager(team: impl Display) -> String {
        format!("You are no longer a team manager of the team {team}.")
    }
    pub fn removed_from_team(team: impl Display) -> String {
        format!("You were removed from the team {team}.")
    }
}
