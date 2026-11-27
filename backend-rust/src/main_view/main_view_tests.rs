use super::open_graph::{
    DatasetRef, OpenGraphTags, PageType, dataset_ref, default_tags, detect_page_type,
    resolve_long_link, short_link_key,
};
use super::*;
use crate::util::id::ObjectId;

const ID: &str = "5f0c5c6a1f00000000000001";

#[test]
fn page_types_follow_play() {
    assert_eq!(
        detect_page_type(&format!("/datasets/name-{ID}/view")),
        PageType::Dataset
    );
    assert_eq!(detect_page_type("/datasets/org/name"), PageType::Dataset);
    assert_eq!(
        detect_page_type("/datasets/org/name/view"),
        PageType::Dataset
    );
    // Play's one-group dataset regexes never match in detectPageType.
    assert_eq!(
        detect_page_type(&format!("/datasets/name-{ID}")),
        PageType::Unknown
    );
    assert_eq!(
        detect_page_type("/datasets/org/name/edit"),
        PageType::Unknown
    );
    assert_eq!(detect_page_type("/datasets/a#b/view"), PageType::Unknown);
    assert_eq!(
        detect_page_type(&format!("/annotations/{ID}")),
        PageType::Annotation
    );
    assert_eq!(
        detect_page_type(&format!("/annotations/{ID}/x")),
        PageType::Unknown
    );
    assert_eq!(detect_page_type("/workflows/hash"), PageType::Workflow);
    assert_eq!(detect_page_type("/dashboard"), PageType::Unknown);
    assert_eq!(detect_page_type("/"), PageType::Unknown);
}

#[test]
fn dataset_routes_resolve_ids_and_legacy_names() {
    let id: ObjectId = ID.parse().unwrap();
    assert_eq!(
        dataset_ref(&format!("/datasets/my-data-{ID}/view")),
        Some(DatasetRef::Id(Some(id.clone())))
    );
    assert_eq!(
        dataset_ref(&format!("/datasets/{ID}/view")),
        Some(DatasetRef::Id(Some(id.clone())))
    );
    assert_eq!(
        dataset_ref(&format!("/datasets/{ID}-/view")),
        Some(DatasetRef::Id(Some(id)))
    );
    assert_eq!(
        dataset_ref("/datasets/no-id/view"),
        Some(DatasetRef::Id(None))
    );
    assert_eq!(
        dataset_ref("/datasets/org/dir"),
        Some(DatasetRef::Legacy {
            organization_id: "org".into(),
            directory_name: "dir".into()
        })
    );
    assert_eq!(
        dataset_ref("/datasets/org/dir/view"),
        Some(DatasetRef::Legacy {
            organization_id: "org".into(),
            directory_name: "dir".into()
        })
    );
}

#[test]
fn short_links_resolve_path_and_token() {
    assert_eq!(short_link_key("/links/abc"), Some("abc"));
    assert_eq!(short_link_key("/link/abc"), None);
    assert_eq!(
        resolve_long_link(&format!(
            "https://wk.example/annotations/{ID}?sharingToken=s&token=t#hash"
        )),
        Some((format!("/annotations/{ID}"), Some("t".into())))
    );
    assert_eq!(
        resolve_long_link("/datasets/org/dir/view?sharingToken=s%20x"),
        Some(("/datasets/org/dir/view".into(), Some("s x".into())))
    );
    assert_eq!(
        resolve_long_link("https://wk.example/dashboard"),
        Some(("/dashboard".into(), None))
    );
}

#[test]
fn default_tags_use_the_logo() {
    assert_eq!(
        default_tags("https://wk.example", PageType::Unknown),
        OpenGraphTags {
            title: Some("WEBKNOSSOS".into()),
            description: None,
            image: Some("https://wk.example/images/og-image.png".into()),
        }
    );
    assert_eq!(
        default_tags("https://wk.example", PageType::Workflow)
            .description
            .as_deref(),
        Some("View this voxelytics workflow report in WEBKNOSSOS")
    );
}

#[test]
fn wildcards_match_whole_paths() {
    assert!(matches_wildcard("/", "/"));
    assert!(!matches_wildcard("/", "/x"));
    assert!(matches_wildcard("/features*", "/features"));
    assert!(matches_wildcard("/features*", "/features/a/b"));
    assert!(matches_wildcard("/a/*/c", "/a/b/c"));
    assert!(!matches_wildcard("/a/*/c", "/a/b/d"));
    assert!(matches_wildcard("*", "/anything"));
    assert!(!matches_wildcard("/a*a", "/a"));
    assert!(matches_wildcard("/a*a", "/aa"));
    assert!(!matches_wildcard("/pricing", "/pricing/x"));
}

#[test]
fn service_worker_paths() {
    assert!(is_service_worker_path("/sw.abc.js"));
    assert!(is_service_worker_path("/sw..js"));
    assert!(!is_service_worker_path("/sw.js"));
    assert!(!is_service_worker_path("/assets/sw.abc.js"));
}

const TEMPLATE: &str = r#"<head>
  <meta name="commit-hash" content="" />
  <meta name="selected-theme" content="" />
  <!-- INJECT_THEME_CSS -->
  <title>Loading | WEBKNOSSOS</title>
  <!-- INJECT_OPENGRAPH_METADATA -->
  <!-- INJECT_WKORG_METADATA -->
  <!-- INJECT_AIRBRAKE_CONFIG -->
</head>"#;

fn input<'a>(tags: &'a OpenGraphTags, airbrake: &'a AirbrakeConfig) -> RenderInput<'a> {
    RenderInput {
        commit_hash: "abc123",
        theme: Some("dark"),
        tags,
        is_wkorg_instance: false,
        airbrake,
    }
}

#[test]
fn render_replaces_every_placeholder() {
    let tags = OpenGraphTags {
        title: Some("A \"quoted\" <name> | WEBKNOSSOS".into()),
        description: None,
        image: Some("https://wk.example/x?w=1&h=2".into()),
    };
    let airbrake = MainViewConfig::default().airbrake;
    let rendered = render(TEMPLATE, &input(&tags, &airbrake)).unwrap();
    // The empty wkorg placeholder leaves its indentation behind (editors strip it below).
    assert!(rendered.contains("\n  \n  <script"));
    assert_eq!(
        rendered.replace("\n  \n", "\n\n"),
        r#"<head>
  <meta name="commit-hash" content="abc123" />
  <meta name="selected-theme" content="dark" />
  <style>html { background: black }</style>
  <title>WEBKNOSSOS</title>
  <meta property="og:title" content="A &quot;quoted&quot; &lt;name&gt; | WEBKNOSSOS" />
    <meta property="og:image" content="https://wk.example/x?w=1&amp;h=2" />

  <script
      data-airbrake-project-id="insert-valid-projectID-here"
      data-airbrake-project-key="insert-valid-projectKey-here"
      data-airbrake-environment-name="dev-local"
    ></script>
</head>"#
    );
}

#[test]
fn render_themes_and_wkorg_metadata() {
    let tags = default_tags("http://localhost:9000", PageType::Unknown);
    let airbrake = MainViewConfig::default().airbrake;
    let anonymous = RenderInput {
        theme: None,
        is_wkorg_instance: true,
        ..input(&tags, &airbrake)
    };
    let rendered = render(TEMPLATE, &anonymous).unwrap();
    assert!(rendered.contains(r#"<meta name="selected-theme" content="auto" />"#));
    assert!(rendered.contains("@media (prefers-color-scheme: dark)"));
    assert!(rendered.contains(WKORG_METADATA));
    let light = RenderInput {
        theme: Some("light"),
        ..input(&tags, &airbrake)
    };
    assert!(!render(TEMPLATE, &light).unwrap().contains("<style>"));
}

#[test]
fn render_fails_without_a_placeholder() {
    let tags = default_tags("http://localhost:9000", PageType::Unknown);
    let airbrake = MainViewConfig::default().airbrake;
    let template = TEMPLATE.replace("<!-- INJECT_WKORG_METADATA -->", "");
    assert_eq!(render(&template, &input(&tags, &airbrake)), None);
}

#[test]
fn config_reads_redirect_routes_and_public_dir() {
    let values = [
        ("WK_PUBLIC_DIR", "../public"),
        ("WK_ABOUT_PAGE_REDIRECT_PREFIX", "https://home.example"),
        ("WK_ABOUT_PAGE_REDIRECT_ROUTES", "/, /features*, ,/pricing"),
        ("WK_AIRBRAKE_ENVIRONMENT", "prod"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect();
    let config = config_from_values(&values).unwrap();
    assert_eq!(config.public_dir, PathBuf::from("../public"));
    assert_eq!(config.about_page_redirect_prefix, "https://home.example");
    assert_eq!(
        config.about_page_redirect_routes,
        ["/", "/features*", "/pricing"]
    );
    assert_eq!(config.airbrake.environment, "prod");
    assert_eq!(config.airbrake.project_id, "insert-valid-projectID-here");
}

/// The frontend's index.html (the template vite builds into `public/`) keeps every placeholder.
#[test]
fn frontend_index_html_has_every_placeholder() {
    let template = include_str!("../../../index.html");
    let tags = default_tags("http://localhost:9000", PageType::Unknown);
    let airbrake = MainViewConfig::default().airbrake;
    assert!(render(template, &input(&tags, &airbrake)).is_some());
}
