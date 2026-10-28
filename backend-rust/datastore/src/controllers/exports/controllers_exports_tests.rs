use super::*;

#[test]
fn content_disposition_like_play() {
    assert_eq!(
        content_disposition_attachment("export.zip"),
        "attachment; filename=\"export.zip\""
    );
    assert_eq!(
        content_disposition_attachment("a\"b.zip"),
        "attachment; filename=\"a\\\"b.zip\""
    );
    assert_eq!(
        content_disposition_attachment("naïve 1.tif"),
        "attachment; filename=\"na?ve 1.tif\"; filename*=utf-8''na%C3%AFve%201.tif"
    );
}
