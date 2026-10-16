use super::*;

fn axis(name: &str, index: i32, bounds: [i32; 2]) -> AdditionalAxis {
    AdditionalAxis {
        name: name.into(),
        bounds: bounds.to_vec(),
        index,
    }
}

#[test]
fn parses_coordinates_like_scala() {
    assert_eq!(
        parse_dot_coordinates("0.1.2.3", &[]).unwrap(),
        (1, 2, 3, None)
    );
    // Java `split` drops trailing empty strings.
    assert_eq!(
        parse_dot_coordinates("0.1.2.3..", &[]).unwrap(),
        (1, 2, 3, None)
    );
    let axes = [axis("t", 1, [0, 5])];
    let (x, y, z, extra) = parse_dot_coordinates("0.4.1.2.3", &axes).unwrap();
    assert_eq!((x, y, z), (1, 2, 3));
    assert_eq!(
        extra.unwrap(),
        [RequestedAdditionalCoordinate {
            name: "t".into(),
            value: 4,
            length: None
        }]
    );
    assert_eq!(
        parse_dot_coordinates("1.1.2.3", &[]).unwrap_err().message,
        INVALID_FIRST_CHUNK_COORD
    );
    assert_eq!(
        parse_dot_coordinates("0.1.2", &[]).unwrap_err().message,
        NOT_ENOUGH_COORDINATES
    );
    assert_eq!(
        parse_dot_coordinates("0.1.2.3", &axes).unwrap_err().message,
        INVALID_ADDITIONAL_COORDINATES
    );
    assert!(parse_dot_coordinates("0.a.2.3", &[]).is_err());
    assert!(parse_dot_coordinates("...", &[]).is_err());
}

#[test]
fn reorders_axes_from_one() {
    let axes = reorder_additional_axes(&[axis("b", 7, [0, 2]), axis("a", 3, [0, 3])]);
    assert_eq!(
        axes.iter()
            .map(|a| (a.name.as_str(), a.index))
            .collect::<Vec<_>>(),
        [("a", 1), ("b", 2)]
    );
}

#[test]
fn directory_listing_escapes_entries() {
    let html = directory_html("Datastore", "id/<x>", &[".zgroup".into(), "a&b".into()]);
    assert!(html.contains("WEBKNOSSOS Datastore “id/&lt;x&gt;” folder."));
    assert!(html.contains("<li><a href=\"a&amp;b\">a&amp;b</a></li>"));
    assert!(html.starts_with("\n<!DOCTYPE html>"));
}
