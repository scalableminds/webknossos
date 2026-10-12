//! Scala `storage/DataVaultService` plus the credential lookups of `services/ManagedS3Service`
//! (`findGlobalCredentialFor`, `pathIsInManagedS3`).
//!
//! Vaults are cached per [`CredentializedUPath`] (Scala `AlfuCache(maxCapacity = 200)`, default
//! time-to-live / time-to-idle); zip paths are keyed by their zip root (`outer|zip`).

use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

use reqwest::Client;

use super::{
    BoxFuture, DataVault, DataVaultCredential, FileSystemDataVault, HttpsDataVault, UPath,
    VaultPath,
    gcs::{GcsOptions, GoogleCloudDataVault},
    http::build_http_client,
    s3::{S3DataVault, S3Options, build_s3_http_client},
    sigv4::AwsCredentials,
};
use crate::{
    config::DatastoreConfig,
    error::{DsError, DsResult},
    models::datasource::{LayerAttachment, MagLocator},
    wk_client::{AlfuCache, WkClient},
};

/// Scala `Msg.DataVault.setupFailed`.
pub const MSG_SETUP_FAILED: &str = "Could not set up remote file system access.";
/// Scala `Msg.Dataset.Mag.pathNotAbsolute`.
pub const MSG_MAG_PATH_NOT_ABSOLUTE: &str = "The mag path is ambiguous, must be absolute.";
/// Scala `vaultCache` capacity.
pub const VAULT_CACHE_CAPACITY: usize = 200;

const CREDENTIAL_CLASS_PREFIX: &str = "com.scalableminds.webknossos.datastore.storage.";

/// Scala `CredentializedUPath`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CredentializedUPath {
    pub upath: UPath,
    pub credential: Option<DataVaultCredential>,
}

impl CredentializedUPath {
    pub fn new(upath: UPath, credential: Option<DataVaultCredential>) -> Self {
        Self { upath, credential }
    }
}

/// Lookup of user-defined credentials by id (Scala `DSRemoteWebknossosClient.getCredential`).
pub trait CredentialLookup: Send + Sync {
    fn find_credential<'a>(
        &'a self,
        credential_id: &'a str,
    ) -> BoxFuture<'a, DsResult<DataVaultCredential>>;
}

impl CredentialLookup for WkClient {
    fn find_credential<'a>(
        &'a self,
        credential_id: &'a str,
    ) -> BoxFuture<'a, DsResult<DataVaultCredential>> {
        Box::pin(async move {
            let value = self.get_credential(credential_id).await?;
            // The parse error names fields only, never values.
            DataVaultCredential::from_json(&value).map_err(|message| {
                DsError::failure(format!(
                    "Could not parse credential {credential_id}: {message}"
                ))
            })
        })
    }
}

/// Settings of a [`DataVaultService`].
#[derive(Debug, Clone)]
pub struct DataVaultServiceOptions {
    /// `http.uri` (user tokens are only forwarded to this datastore).
    pub datastore_uri: String,
    /// `datastore.localDirectoryWhitelist`.
    pub local_directory_whitelist: Vec<String>,
    /// `datastore.dataVaults.credentials`.
    pub global_credentials: Vec<DataVaultCredential>,
    /// Working directory relative local paths resolve against (Scala `Path.of(".")`).
    pub working_dir: PathBuf,
    pub s3: S3Options,
    pub gcs: GcsOptions,
}

impl DataVaultServiceOptions {
    /// From the datastore config and the process environment (AWS / Google credentials).
    pub fn from_config(config: &DatastoreConfig) -> Self {
        Self {
            datastore_uri: config.http.uri.clone(),
            local_directory_whitelist: config.local_directory_whitelist.clone(),
            global_credentials: config
                .data_vault_credentials
                .iter()
                .map(DataVaultCredential::from)
                .collect(),
            working_dir: std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
            s3: S3Options::from_env(),
            gcs: GcsOptions::from_env(),
        }
    }
}

/// Scala `DataVaultService`. Cheap to clone.
#[derive(Clone)]
pub struct DataVaultService {
    inner: Arc<Inner>,
}

struct Inner {
    cache: AlfuCache<CredentializedUPath, Arc<dyn DataVault>>,
    http_client: Client,
    s3_client: Client,
    options: DataVaultServiceOptions,
    credential_lookup: Arc<dyn CredentialLookup>,
}

impl DataVaultService {
    pub fn new(
        options: DataVaultServiceOptions,
        credential_lookup: Arc<dyn CredentialLookup>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                // Scala `AlfuCache(maxCapacity = 200)`: default 2 h time to live, 1 h to idle.
                cache: AlfuCache::new(
                    VAULT_CACHE_CAPACITY,
                    Duration::from_secs(2 * 60 * 60),
                    Duration::from_secs(60 * 60),
                ),
                http_client: build_http_client(),
                s3_client: build_s3_http_client(),
                options,
                credential_lookup,
            }),
        }
    }

    pub fn from_config(config: &DatastoreConfig, wk_client: WkClient) -> Self {
        Self::new(
            DataVaultServiceOptions::from_config(config),
            Arc::new(wk_client),
        )
    }

    /// Number of cached vaults.
    pub fn cached_vault_count(&self) -> usize {
        self.inner.cache.len()
    }

    // ---- ManagedS3Service --------------------------------------------------------------------

    /// Scala `ManagedS3Service.findGlobalCredentialFor`: the first global S3 access key whose
    /// name is a prefix path of `path`.
    pub fn find_global_credential_for(&self, path: &UPath) -> Option<DataVaultCredential> {
        self.inner
            .options
            .global_credentials
            .iter()
            .find(|credential| {
                matches!(credential, DataVaultCredential::S3AccessKey { .. })
                    && UPath::parse(credential.name()).is_ok_and(|prefix| path.starts_with(&prefix))
            })
            .cloned()
    }

    /// Scala `ManagedS3Service.pathIsInManagedS3`.
    pub fn path_is_in_managed_s3(&self, path: &UPath) -> bool {
        path.scheme() == Some(super::s3::SCHEME_S3)
            && self
                .inner
                .options
                .global_credentials
                .iter()
                .any(|credential| {
                    UPath::parse(credential.name()).is_ok_and(|prefix| path.starts_with(&prefix))
                })
    }

    // ---- whitelist ---------------------------------------------------------------------------

    fn working_dir(&self) -> UPath {
        UPath::from_local_path(&self.inner.options.working_dir)
    }

    /// Scala `pathIsAllowedToAddDirectly`: local paths must stay inside the working directory
    /// (relative) or a whitelisted directory; remote paths must not point into managed S3.
    pub fn path_is_allowed_to_add_directly(&self, path: &UPath) -> bool {
        if path.is_local() {
            self.path_is_data_source_local(path) || self.path_is_in_local_directory_whitelist(path)
        } else {
            !self.path_is_in_managed_s3(path)
        }
    }

    fn path_is_data_source_local(&self, path: &UPath) -> bool {
        let working_dir = self.working_dir();
        path.is_local()
            && !path.is_absolute()
            && working_dir.join_upath(path).starts_with(&working_dir)
    }

    fn path_is_in_local_directory_whitelist(&self, path: &UPath) -> bool {
        let working_dir = self.working_dir();
        let absolute = working_dir.join_upath(path);
        path.is_local()
            && self
                .inner
                .options
                .local_directory_whitelist
                .iter()
                .any(|entry| absolute.starts_with(&working_dir.join(entry)))
    }

    // ---- vault paths -------------------------------------------------------------------------

    /// Scala `vaultPathFor(upath)` (with the matching global credential).
    pub async fn vault_path_for(&self, upath: &UPath) -> DsResult<VaultPath> {
        let credential = self.find_global_credential_for(upath);
        self.vault_path_for_credentialized(CredentializedUPath::new(upath.clone(), credential))
            .await
    }

    /// Scala `vaultPathFor(localPath)`.
    pub async fn vault_path_for_local(&self, path: &Path) -> DsResult<VaultPath> {
        self.vault_path_for(&UPath::from_local_path(path)).await
    }

    /// Scala `vaultPathFor(magLocator)`.
    pub async fn vault_path_for_mag(&self, mag: &MagLocator) -> DsResult<VaultPath> {
        let credentialized = self.credentialized_upath_for_mag(mag).await?;
        self.vault_path_for_credentialized(credentialized).await
    }

    /// Scala `vaultPathFor(attachment)` (attachment paths are already resolved).
    pub async fn vault_path_for_attachment(
        &self,
        attachment: &LayerAttachment,
    ) -> DsResult<VaultPath> {
        let credential = self.credential_for_attachment(attachment).await;
        self.vault_path_for_credentialized(CredentializedUPath::new(
            attachment.path.clone(),
            credential,
        ))
        .await
    }

    /// Scala `removeVaultFromCache(magLocator)`.
    pub async fn remove_vault_from_cache_for_mag(&self, mag: &MagLocator) -> DsResult<()> {
        let credentialized = self.credentialized_upath_for_mag(mag).await?;
        self.inner
            .cache
            .remove(&vault_cache_key_for(&credentialized));
        Ok(())
    }

    /// Scala `removeVaultFromCache(attachment)`.
    pub async fn remove_vault_from_cache_for_attachment(&self, attachment: &LayerAttachment) {
        let credential = self.credential_for_attachment(attachment).await;
        let key = CredentializedUPath::new(attachment.path.clone(), credential);
        self.inner.cache.remove(&vault_cache_key_for(&key));
    }

    /// Scala `resolveMagPath`.
    pub fn resolve_mag_path(mag: &MagLocator, local_dataset_dir: &Path, layer_dir: &Path) -> UPath {
        match &mag.path {
            Some(path) => path.resolved_in(&UPath::from_local_path(local_dataset_dir)),
            None => {
                let scalar = layer_dir.join(mag.mag.to_mag_literal(true));
                if scalar.exists() {
                    UPath::from_local_path(&scalar)
                } else {
                    UPath::from_local_path(&layer_dir.join(mag.mag.to_mag_literal(false)))
                }
            }
        }
    }

    async fn credentialized_upath_for_mag(
        &self,
        mag: &MagLocator,
    ) -> DsResult<CredentializedUPath> {
        let credential = self.credential_for_mag(mag).await;
        let path = mag.path.clone().ok_or_else(DsError::empty)?;
        if !path.is_absolute() {
            return Err(DsError::failure(MSG_MAG_PATH_NOT_ABSOLUTE));
        }
        Ok(CredentializedUPath::new(path, credential))
    }

    /// Scala `credentialFor(magLocator)` followed by `.shiftBox ... .toOption`: lookup failures
    /// fall back to no credential.
    async fn credential_for_mag(&self, mag: &MagLocator) -> Option<DataVaultCredential> {
        match (&mag.credential_id, &mag.credentials) {
            (Some(id), _) => self.lookup_credential(id).await,
            (None, Some(legacy)) => Some(DataVaultCredential::legacy(
                legacy.user.clone(),
                legacy.password.clone(),
            )),
            (None, None) => mag
                .path
                .as_ref()
                .and_then(|p| self.find_global_credential_for(p)),
        }
    }

    async fn credential_for_attachment(
        &self,
        attachment: &LayerAttachment,
    ) -> Option<DataVaultCredential> {
        match &attachment.credential_id {
            Some(id) => self.lookup_credential(id).await,
            None => self.find_global_credential_for(&attachment.path),
        }
    }

    async fn lookup_credential(&self, id: &str) -> Option<DataVaultCredential> {
        match self.inner.credential_lookup.find_credential(id).await {
            Ok(credential) => Some(credential),
            Err(error) => {
                tracing::debug!(credential_id = id, error = %error.message, "credential lookup failed, continuing without credential");
                None
            }
        }
    }

    /// Scala `vaultPathFor(credentializedUPath)`.
    pub async fn vault_path_for_credentialized(
        &self,
        credentialized: CredentializedUPath,
    ) -> DsResult<VaultPath> {
        let key = vault_cache_key_for(&credentialized);
        let vault = self
            .inner
            .cache
            .get_or_load(key.clone(), || async { self.create_vault(&key) })
            .await
            .map_err(|e| e.wrap(MSG_SETUP_FAILED))?;
        Ok(VaultPath::new(credentialized.upath, vault))
    }

    fn create_vault(&self, credentialized: &CredentializedUPath) -> DsResult<Arc<dyn DataVault>> {
        let upath = &credentialized.upath;
        if let UPath::ZipEntry(outer, _) = upath {
            if matches!(**outer, UPath::ZipEntry(..)) {
                return Err(DsError::failure("Nested zip paths are not supported."));
            }
            // TODO(DS1c): Scala `ZipDataVault` over the outer vault path.
            return Err(DsError::failure(format!(
                "Zip data vaults are not supported by the Rust datastore yet: {upath}"
            )));
        }
        let result = self.create_plain_vault(credentialized);
        match &result {
            Ok(_) => tracing::info!("Created data vault for {upath}."),
            Err(error) => {
                tracing::warn!("Failed to create DataVault for {upath}: {}", error.message)
            }
        }
        result
    }

    fn create_plain_vault(
        &self,
        credentialized: &CredentializedUPath,
    ) -> DsResult<Arc<dyn DataVault>> {
        let upath = &credentialized.upath;
        let credential = credentialized.credential.as_ref();
        let options = &self.inner.options;
        Ok(match upath.scheme() {
            Some("gs") => {
                let secret_json = match credential {
                    None => None,
                    Some(DataVaultCredential::GoogleServiceAccount { secret_json, .. }) => {
                        Some(secret_json.as_str())
                    }
                    Some(other) => return Err(class_cast_failure(other)),
                };
                Arc::new(GoogleCloudDataVault::new(
                    upath.to_remote_uri()?,
                    secret_json,
                    self.inner.http_client.clone(),
                    &options.gcs,
                ))
            }
            Some("s3") => {
                let access_key = credential
                    .and_then(DataVaultCredential::s3_access_key)
                    .map(|(id, secret)| AwsCredentials::new(id, secret));
                Arc::new(S3DataVault::new(
                    upath.to_remote_uri()?,
                    access_key,
                    self.inner.s3_client.clone(),
                    &options.s3,
                ))
            }
            Some("https" | "http") => Arc::new(HttpsDataVault::new(
                credential.cloned(),
                self.inner.http_client.clone(),
                &options.datastore_uri,
            )),
            None => Arc::new(FileSystemDataVault),
            Some(other) => {
                return Err(DsError::failure(format!(
                    "Unknown file system scheme Some({other})"
                )));
            }
        })
    }
}

/// Scala `vaultCacheKeyFor`: zip paths are keyed by their zip root.
fn vault_cache_key_for(credentialized: &CredentializedUPath) -> CredentializedUPath {
    match &credentialized.upath {
        UPath::ZipEntry(outer, _) => CredentializedUPath::new(
            UPath::ZipEntry(outer.clone(), String::new()),
            credentialized.credential.clone(),
        ),
        _ => credentialized.clone(),
    }
}

/// Scala `tryo(credential.asInstanceOf[GoogleServiceAccountCredential])` failing.
fn class_cast_failure(credential: &DataVaultCredential) -> DsError {
    let class = match credential {
        DataVaultCredential::HttpBasicAuth { .. } => "HttpBasicAuthCredential",
        DataVaultCredential::XAuthToken { .. } => "XAuthTokenCredential",
        DataVaultCredential::S3AccessKey { .. } => "S3AccessKeyCredential",
        DataVaultCredential::GoogleServiceAccount { .. } => "GoogleServiceAccountCredential",
        DataVaultCredential::Legacy { .. } => "LegacyDataVaultCredential",
    };
    DsError::from_exception(format!(
        "java.lang.ClassCastException: class {CREDENTIAL_CLASS_PREFIX}{class} cannot be cast to class {CREDENTIAL_CLASS_PREFIX}GoogleServiceAccountCredential"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_paths_are_keyed_by_their_zip_root() {
        let credential = Some(DataVaultCredential::legacy("u", None));
        let entry = CredentializedUPath::new(
            UPath::parse("s3://bucket/a.zip|zip:inner/file").unwrap(),
            credential.clone(),
        );
        let key = vault_cache_key_for(&entry);
        assert_eq!(key.upath.to_string(), "s3://bucket/a.zip|zip");
        assert_eq!(key.credential, credential);
        assert_eq!(
            key,
            vault_cache_key_for(&CredentializedUPath::new(
                UPath::parse("s3://bucket/a.zip|zip:other").unwrap(),
                credential.clone(),
            ))
        );
        let outer =
            CredentializedUPath::new(UPath::parse("s3://bucket/a.zip").unwrap(), credential);
        assert_eq!(vault_cache_key_for(&outer), outer);
        assert_ne!(vault_cache_key_for(&outer), key);
    }
}
