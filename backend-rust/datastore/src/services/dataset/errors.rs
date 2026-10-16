//! Scala DatasetErrorLoggingService: at most five errors per dataset per hourly window.
use crate::{
    HealthProblems,
    datavault::{VaultError, VaultResult},
    error::DsError,
    models::DataSourceId,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
struct Errors {
    window: Instant,
    counts: HashMap<DataSourceId, usize>,
}
#[derive(Clone)]
pub struct DatasetErrorLoggingService {
    inner: Arc<Mutex<Errors>>,
    health: HealthProblems,
}
impl DatasetErrorLoggingService {
    pub fn new(health: HealthProblems) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Errors {
                window: Instant::now(),
                counts: HashMap::new(),
            })),
            health,
        }
    }
    pub fn clear_for_dataset(&self, id: &DataSourceId) {
        self.inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .counts
            .remove(id);
    }
    pub fn logged_error_count(&self, id: &DataSourceId) -> usize {
        *self
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .counts
            .get(id)
            .unwrap_or(&0)
    }
    pub fn check(
        &self,
        id: &DataSourceId,
        dataset_id: Option<&str>,
        label: &str,
        result: VaultResult<Vec<u8>>,
    ) -> VaultResult<Vec<u8>> {
        let result = match result {
            Ok(data) if data.is_empty() => Err(VaultError::failure(format!(
                "Zero-length array returned while {label} for {dataset_id:?} ({id})"
            ))),
            other => other,
        };
        if let Err(VaultError::Failure(error)) = &result {
            if error
                .exception
                .as_deref()
                .is_some_and(|e| e.starts_with("java.lang.InternalError"))
            {
                self.health.push(error.to_string());
                tracing::error!(source=%id, label, error=%error,"Caught internal dataset error");
            } else {
                let mut errors = self.inner.lock().unwrap_or_else(|e| e.into_inner());
                if errors.window.elapsed() >= Duration::from_secs(3600) {
                    errors.counts.clear();
                    errors.window = Instant::now();
                }
                let count = errors.counts.entry(id.clone()).or_default();
                if *count < 5 {
                    tracing::error!(source=%id, dataset_id, label,error=%error,"Dataset data-loading error");
                    *count += 1;
                    if *count == 5 {
                        tracing::info!(source=%id,"Muting dataset errors until hourly reset or reload");
                    }
                }
            }
        }
        result
    }
    pub fn check_conversion(
        &self,
        id: &DataSourceId,
        dataset: Option<&str>,
        result: Result<Vec<u8>, DsError>,
    ) -> VaultResult<Vec<u8>> {
        self.check(
            id,
            dataset,
            "converting bucket data",
            result.map_err(VaultError::from),
        )
    }
}
