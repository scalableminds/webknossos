//! User-facing messages from Play's catalog (`util/src/main/scala/com/scalableminds/util/Msg.scala`).
//!
//! The frontend shows these texts verbatim in toasts, so they are copied exactly, including the
//! typographic quotes. Names follow the Scala objects (`Msg.Project.notFound(id)` →
//! `msg::project::not_found(id)`). Add entries here instead of inventing new wording at call sites.
//! Entries marked *Rust-only* have no Play counterpart (request extraction, stricter checks).

pub const NOT_ALLOWED: &str = "You are not authorized to view or edit this resource.";
pub const NOT_FOUND: &str = "Could not find or access the requested resource.";
pub const SHORT_LINK_NOT_FOUND: &str = "No shortlink with this key could be found.";

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
    /// Play's query binder for an invalid Boolean parameter.
    pub fn invalid_boolean(name: impl Display) -> String {
        format!("Cannot parse parameter {name} as Boolean: should be true, false, 0 or 1")
    }
    /// Play's query binder for an invalid Long parameter.
    pub fn invalid_long(name: impl Display, value: impl Display) -> String {
        format!("Cannot parse parameter {name} as Long: For input string: \"{value}\"")
    }
}

pub mod object_id {
    use std::fmt::Display;

    pub fn invalid(literal: impl Display) -> String {
        format!("The supplied resource id “{literal}” is not a valid ObjectId.")
    }
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
}

pub mod task {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Task “{id}” could not be found or accessed.")
    }
    pub const UNAVAILABLE: &str = "There is currently no task available.";
    pub const DELETE_SUCCESS: &str = "Task was successfully deleted.";
    pub const EDIT_SUCCESS: &str = "Task was successfully updated.";
}

pub mod script {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Script “{id}” could not be found or accessed.")
    }
}

pub mod team {
    use std::fmt::Display;

    pub fn not_found(id: impl Display) -> String {
        format!("Team “{id}” could not be found or accessed.")
    }
    pub const ADMIN_NOT_ALLOWED: &str = "You do not have permission to administrate this team.";
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
}

pub mod data_store {
    pub const NOT_FOUND: &str = "Data store could not be found or accessed.";
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
}

pub mod passkeys {
    pub const NOT_ENABLED: &str = "Passkeys are not enabled for this WEBKNOSSOS instance.";
    pub const REQUIRES_HTTPS: &str = "Passkeys are only supported with HTTPS.";
}

pub mod folder {
    pub const NO_WRITE_ACCESS: &str = "No write access in this folder.";
    /// Rust-only: stricter than Play, which does not check the folder's organization.
    pub const NOT_IN_DATASET_ORGANIZATION: &str =
        "Folder does not belong to the dataset organization.";
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
        }
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
}

pub mod voxelytics {
    pub const NOT_ENABLED: &str =
        "Voxelytics workflow reporting and logging are not enabled for this WEBKNOSSOS instance.";
}
