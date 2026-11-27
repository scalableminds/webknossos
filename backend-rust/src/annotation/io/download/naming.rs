//! Download file names and their encoding in URLs and headers.
use std::fmt::Write as _;

use sqlx::PgPool;

use crate::{
    annotation::access::AnnotationMetadata, job::submission::RunResult, util::id::ObjectId,
};

use super::{
    failure::fail,
    lookups::{find_multi_user, find_user_multi_user},
    params::Context,
    {NAME_NOT_AVAILABLE, annotation_download_dao},
};

/// MultiUser.abbreviatedName.
pub(super) fn abbreviated_name(first_name: &str, last_name: &str) -> String {
    let initial: String = first_name.chars().take(1).collect();
    format!("{initial}{last_name}")
        .to_lowercase()
        .replace(' ', "_")
}

/// TextUtils.normalize (umlaut and accent replacement map).
pub(super) fn normalize(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        let replacement = match c {
            'ü' => "ue",
            'Ü' => "Ue",
            'ö' => "oe",
            'Ö' => "Oe",
            'ä' => "ae",
            'Ä' => "Ae",
            'ß' => "ss",
            'é' | 'è' | 'ê' | 'ë' => "e",
            'È' | 'É' | 'Ê' | 'Ë' => "E",
            'Ç' => "C",
            'ç' => "c",
            'ñ' => "n",
            'Ñ' => "N",
            'ï' | 'í' | 'ì' => "i",
            'Ï' => "I",
            'å' => "a",
            'Å' => "A",
            'œ' => "oe",
            'Œ' => "Oe",
            'æ' => "ae",
            'Æ' => "Ae",
            'þ' => "th",
            'Þ' => "Th",
            'ø' => "oe",
            'Ø' => "Oe",
            other => {
                out.push(other);
                continue;
            }
        };
        out.push_str(replacement);
    }
    out
}

/// SavedTracingInformationHandler.nameForAnnotation:
/// `normalize("<dataset>__<taskId|explorational>__<owner abbreviated>__<id[-6:]>")`.
/// A missing owner or unreadable MultiUser yields an empty user part; a
/// missing dataset is Empty.
pub(super) async fn name_for_annotation(
    pool: &PgPool,
    annotation: AnnotationNameParts<'_>,
    multi_user_readable: bool,
) -> RunResult<Option<String>> {
    let user_name = match find_user_multi_user(pool, annotation.owner_id).await? {
        Some(multi_user) => find_multi_user(pool, &multi_user, multi_user_readable)
            .await?
            .map(|(first, last)| abbreviated_name(&first, &last))
            .unwrap_or_default(),
        None => String::new(),
    };
    let Some(dataset) = annotation_download_dao::find_dataset(pool, annotation.dataset_id).await?
    else {
        return Ok(None);
    };
    let task = annotation.task_id.map_or("explorational", ObjectId::as_str);
    let id = annotation.id.as_str();
    let hash = &id[id.len().saturating_sub(6)..];
    Ok(Some(normalize(&format!(
        "{}__{task}__{user_name}__{hash}",
        dataset.name
    ))))
}

#[derive(Clone, Copy)]
pub(super) struct AnnotationNameParts<'a> {
    pub(super) id: &'a ObjectId,
    pub(super) owner_id: &'a ObjectId,
    pub(super) dataset_id: &'a ObjectId,
    pub(super) task_id: Option<&'a ObjectId>,
}

/// AnnotationInformationProvider.nameFor.
pub(super) async fn name_for(
    context: &Context<'_>,
    annotation: &AnnotationMetadata,
) -> RunResult<String> {
    if !annotation.name.is_empty() {
        return Ok(annotation.name.clone());
    }
    let parts = AnnotationNameParts {
        id: &annotation.id,
        owner_id: &annotation.owner_id,
        dataset_id: &annotation.dataset_id,
        task_id: annotation.task_id.as_ref(),
    };
    name_for_annotation(context.pool(), parts, context.user.is_some())
        .await
        .map_err(|error| error.wrap(NAME_NOT_AVAILABLE))?
        .ok_or_else(|| fail(NAME_NOT_AVAILABLE))
}

/// `URLEncoder.encode(name, "UTF-8").replace("+", "%20")`.
pub(super) fn java_url_encode_path(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

/// `play.core.utils.HttpHeaderParameterEncoding.encode` (Play 3.0.11, checked
/// against the jar): printable ASCII except `"`, `\` and `%` is quoted as is,
/// anything else becomes `?` and adds an RFC 5987 `name*=utf-8''…` parameter
/// (attr-chars raw, other bytes as lowercase `%xx`).
pub fn play_header_parameter(name: &str, value: &str) -> String {
    let mut out = format!("{name}=\"");
    let mut extended = false;
    for c in value.chars() {
        if (' '..='~').contains(&c) && !matches!(c, '"' | '\\' | '%') {
            out.push(c);
        } else {
            extended = true;
            out.push('?');
        }
    }
    out.push('"');
    if extended {
        let _ = write!(out, "; {name}*=utf-8''");
        for byte in value.bytes() {
            if byte.is_ascii_alphanumeric() || b"!#$&+-.^_`|~".contains(&byte) {
                out.push(char::from(byte));
            } else {
                let _ = write!(out, "%{byte:02x}");
            }
        }
    }
    out
}
