//! OpenGraphService: link-preview tags for the main view. Dataset and annotation pages
//! readable by the requester (or the URL's sharing token) get their name and a thumbnail of
//! the first color layer; any failure falls back to generic tags so the page still renders.
use super::main_view_dao;
use crate::{AppState, auth::AuthUser, util::id::ObjectId};

const THUMBNAIL_WIDTH: u32 = 1000;
const THUMBNAIL_HEIGHT: u32 = 300;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenGraphTags {
    pub title: Option<String>,
    pub description: Option<String>,
    pub image: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PageType {
    Dataset,
    Annotation,
    Workflow,
    Unknown,
}

/// A dataset page: by id (`/datasets/<name>-<id>/view`) or legacy organization and directory name.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum DatasetRef {
    Id(Option<ObjectId>),
    Legacy {
        organization_id: String,
        directory_name: String,
    },
}

/// OpenGraphService.getOpenGraphTags; never fails.
pub(crate) async fn tags(
    state: &AppState,
    user: Option<&AuthUser>,
    path: &str,
    sharing_token: Option<String>,
) -> OpenGraphTags {
    let public_uri = &state.misc.config().public_uri;
    let (path, sharing_token) = match short_link_key(path) {
        Some(key) => match main_view_dao::find_long_link(&state.pool, key).await {
            Ok(Some(long_link)) => match resolve_long_link(&long_link) {
                Some(resolved) => resolved,
                None => return default_tags(public_uri, PageType::Unknown),
            },
            _ => return default_tags(public_uri, PageType::Unknown),
        },
        None => (path.to_owned(), sharing_token),
    };
    let page_type = detect_page_type(&path);
    let token = sharing_token.as_deref();
    let tags = match page_type {
        PageType::Dataset => dataset_tags(state, user, &path, token).await,
        PageType::Annotation => annotation_tags(state, user, &path, token).await,
        PageType::Workflow | PageType::Unknown => None,
    };
    tags.unwrap_or_else(|| default_tags(public_uri, page_type))
}

async fn dataset_tags(
    state: &AppState,
    user: Option<&AuthUser>,
    path: &str,
    token: Option<&str>,
) -> Option<OpenGraphTags> {
    let dataset = match dataset_ref(path)? {
        DatasetRef::Id(id) => {
            main_view_dao::find_readable_dataset(&state.pool, user, &id?, token).await
        }
        DatasetRef::Legacy {
            organization_id,
            directory_name,
        } => {
            main_view_dao::find_readable_dataset_by_directory_name(
                &state.pool,
                user,
                &organization_id,
                &directory_name,
                token,
            )
            .await
        }
    }
    .ok()??;
    let layer = main_view_dao::find_first_color_layer(&state.pool, &dataset.id)
        .await
        .ok()?;
    Some(OpenGraphTags {
        title: Some(format!("{} | WEBKNOSSOS", dataset.name)),
        description: Some("View this dataset in WEBKNOSSOS".into()),
        image: thumbnail_uri(&state.misc.config().public_uri, &dataset.id, layer, token),
    })
}

async fn annotation_tags(
    state: &AppState,
    user: Option<&AuthUser>,
    path: &str,
    token: Option<&str>,
) -> Option<OpenGraphTags> {
    let id: ObjectId = annotation_id(path)?.parse().ok()?;
    // AnnotationDAO's anonymous access (public visibility) is part of its user access, so the
    // sharing token only matters for the dataset.
    let annotation = crate::annotation::access::find_optional(&state.pool, user, &id, false)
        .await
        .ok()??;
    let dataset =
        main_view_dao::find_readable_dataset(&state.pool, user, &annotation.dataset_id, token)
            .await
            .ok()??;
    let layer = main_view_dao::find_first_color_layer(&state.pool, &dataset.id)
        .await
        .ok()?;
    let title = if annotation.name.is_empty() {
        &dataset.name
    } else {
        &annotation.name
    };
    Some(OpenGraphTags {
        title: Some(format!("{title} | WEBKNOSSOS")),
        description: Some(format!(
            "View this annotation on dataset {} in WEBKNOSSOS",
            dataset.name
        )),
        image: thumbnail_uri(&state.misc.config().public_uri, &dataset.id, layer, token),
    })
}

fn thumbnail_uri(
    public_uri: &str,
    dataset_id: &ObjectId,
    layer: Option<String>,
    token: Option<&str>,
) -> Option<String> {
    layer.map(|layer| {
        let token = token
            .map(|token| format!("&sharingToken={token}"))
            .unwrap_or_default();
        format!(
            "{public_uri}/api/datasets/{dataset_id}/layers/{layer}/thumbnail\
             ?w={THUMBNAIL_WIDTH}&h={THUMBNAIL_HEIGHT}{token}"
        )
    })
}

pub(crate) fn default_tags(public_uri: &str, page_type: PageType) -> OpenGraphTags {
    let description = match page_type {
        PageType::Dataset => Some("View this dataset in WEBKNOSSOS"),
        PageType::Annotation => Some("View this annotation in WEBKNOSSOS"),
        PageType::Workflow => Some("View this voxelytics workflow report in WEBKNOSSOS"),
        // Most clients fall back to <meta name="description">, see the template.
        PageType::Unknown => None,
    };
    OpenGraphTags {
        title: Some("WEBKNOSSOS".into()),
        description: description.map(str::to_owned),
        image: Some(format!("{public_uri}/images/og-image.png")),
    }
}

/// `^/links/(.*)`.
pub(crate) fn short_link_key(path: &str) -> Option<&str> {
    path.strip_prefix("/links/")
}

/// The path and `token` (else `sharingToken`) query value of a short link's long link.
pub(crate) fn resolve_long_link(long_link: &str) -> Option<(String, Option<String>)> {
    let base = url::Url::parse("http://localhost").ok()?;
    let url = url::Url::options()
        .base_url(Some(&base))
        .parse(long_link)
        .ok()?;
    let value = |key: &str| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.into_owned())
    };
    let token = value("token").or_else(|| value("sharingToken"));
    Some((url.path().to_owned(), token))
}

/// The segments after `/datasets/` if each is a nonempty run of characters other than `/^#`
/// (Scala's `[^/^#]+`) and the path has nothing else.
fn dataset_segments(path: &str) -> Option<Vec<&str>> {
    let segments: Vec<&str> = path.strip_prefix("/datasets/")?.split('/').collect();
    segments
        .iter()
        .all(|segment| !segment.is_empty() && !segment.contains(['^', '#']))
        .then_some(segments)
}

/// `^/<prefix>/([^/^#]+)`: the single segment after `prefix`.
fn single_segment<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    let segment = path.strip_prefix(prefix)?;
    (!segment.is_empty() && !segment.contains(['/', '^', '#'])).then_some(segment)
}

fn annotation_id(path: &str) -> Option<&str> {
    single_segment(path, "/annotations/")
}

/// OpenGraphService.detectPageType. Scala matches the one-group dataset regexes with two
/// extractors, which never succeeds, so only two- or three-segment dataset paths count as
/// dataset pages: `/datasets/<name>-<id>/view` does (via the legacy two-segment regex), but
/// `/datasets/<name>-<id>` gets the unknown-page tags. Kept for parity with Play.
pub(crate) fn detect_page_type(path: &str) -> PageType {
    match dataset_segments(path) {
        Some(segments) if segments.len() == 2 => return PageType::Dataset,
        Some(segments) if segments.len() == 3 && segments[2] == "view" => {
            return PageType::Dataset;
        }
        _ => {}
    }
    if annotation_id(path).is_some() {
        PageType::Annotation
    } else if single_segment(path, "/workflows/").is_some() {
        PageType::Workflow
    } else {
        PageType::Unknown
    }
}

/// OpenGraphService.datasetOpenGraphTags' route matching, for paths detected as dataset pages.
pub(crate) fn dataset_ref(path: &str) -> Option<DatasetRef> {
    let segments = dataset_segments(path)?;
    match segments.as_slice() {
        [name_and_id] | [name_and_id, "view"] => Some(DatasetRef::Id(dataset_id(name_and_id))),
        [organization_id, directory_name] | [organization_id, directory_name, "view"] => {
            Some(DatasetRef::Legacy {
                organization_id: (*organization_id).to_owned(),
                directory_name: (*directory_name).to_owned(),
            })
        }
        _ => None,
    }
}

/// `<dataset name>-<id>` or `<id>`: the last `-`-separated part (Java's `split` drops
/// trailing empty parts).
fn dataset_id(name_and_id: &str) -> Option<ObjectId> {
    name_and_id
        .rsplit('-')
        .find(|part| !part.is_empty())?
        .parse()
        .ok()
}
