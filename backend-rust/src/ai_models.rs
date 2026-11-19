//! AiModelController (batch J5a): list/read/update/delete AI models, the model
//! voxel size, and list/read AI inferences, plus the `AiModelService` and
//! `AiInferenceService` serializers. J5b-1 adds the model upload-to-path routes
//! ([`upload_router`]); J5b-2 adds model training submission and J5b-3
//! inference submission.

pub(crate) mod ai_models_dao;
mod inference;
mod routes;
mod service;
mod training;
mod upload;

pub use routes::router;
pub use upload::upload_router;

#[cfg(test)]
mod ai_models_tests;
