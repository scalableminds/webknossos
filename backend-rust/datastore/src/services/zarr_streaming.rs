//! Output side of Scala `ZarrStreamingController`: wk layers exposed as Zarr v2 / v3 arrays
//! (`Zarr3OutputHelper`, `ZarrCoordinatesParser`, `Zarr3ArrayHeader.fromDataLayer`,
//! `convertLayerToZarrLayer`) and the `datastoreZarrDatasourceDir` directory listing.
use serde_json::{Map, Value, json};

use crate::{
    datareaders::RequestedAdditionalCoordinate,
    error::{DsError, DsResult},
    models::{
        AdditionalAxis, AxisOrder, BUCKET_LENGTH, DataFormat, MagLocator, StaticLayer, UPath,
        Vec3Int,
    },
};

pub const FILENAME_ZARR_JSON: &str = "zarr.json";

const INVALID_FIRST_CHUNK_COORD: &str = "First channel must be 0.";
const NOT_ENOUGH_COORDINATES: &str =
    "Invalid number of chunk coordinates. Expected to get at least 3 dimensions and channel 0.";
const INVALID_ADDITIONAL_COORDINATES: &str = "Invalid additional coordinates for this data layer.";

/// Scala `reorderAdditionalAxes`: sorted by index, re-indexed from 1 (channel comes first).
pub fn reorder_additional_axes(axes: &[AdditionalAxis]) -> Vec<AdditionalAxis> {
    let mut sorted = axes.to_vec();
    sorted.sort_by_key(|a| a.index);
    for (i, axis) in sorted.iter_mut().enumerate() {
        axis.index = i as i32 + 1;
    }
    sorted
}

/// Java `String.split(regex)` for a single literal character: trailing empty strings are removed,
/// but a string without any separator yields itself.
fn java_split(value: &str, separator: char) -> Vec<&str> {
    if !value.contains(separator) {
        return vec![value];
    }
    let mut parts: Vec<&str> = value.split(separator).collect();
    while parts.last() == Some(&"") {
        parts.pop();
    }
    parts
}

/// Scala `ZarrCoordinatesParser.parseNDimensionalDotCoordinates`: `c.<additional>.x.y.z`.
pub fn parse_dot_coordinates(
    coordinates: &str,
    reordered_axes: &[AdditionalAxis],
) -> DsResult<(i32, i32, i32, Option<Vec<RequestedAdditionalCoordinate>>)> {
    let ints = java_split(coordinates, '.')
        .into_iter()
        .map(|literal| {
            literal
                .parse::<i32>()
                .map_err(|_| DsError::failure(format!("For input string: \"{literal}\"")))
        })
        .collect::<DsResult<Vec<i32>>>()?;
    let Some(&channel) = ints.first() else {
        return Err(DsError::empty());
    };
    if channel != 0 {
        return Err(DsError::failure(INVALID_FIRST_CHUNK_COORD));
    }
    if ints.len() < 4 {
        return Err(DsError::failure(NOT_ENOUGH_COORDINATES));
    }
    let n = ints.len();
    if reordered_axes.len() != n - 4 {
        return Err(DsError::failure(INVALID_ADDITIONAL_COORDINATES));
    }
    let additional = (n > 4).then(|| {
        ints[1..n - 3]
            .iter()
            .zip(reordered_axes)
            .map(|(value, axis)| RequestedAdditionalCoordinate {
                name: axis.name.clone(),
                value: *value,
                length: None,
            })
            .collect()
    });
    Ok((ints[n - 3], ints[n - 2], ints[n - 1], additional))
}

/// Scala `Zarr3ArrayHeader.fromDataLayer(layer, mag)` rendered by `Zarr3ArrayHeaderFormat.writes`.
pub fn zarr3_array_header_json(layer: &StaticLayer, mag: Vec3Int) -> Value {
    let axes = reorder_additional_axes(layer.additional_axes.as_deref().unwrap_or_default());
    let (channels, dtype) = layer.element_class.to_channel_and_zarr3_string();
    let bbox = &layer.bounding_box;
    let mut shape: Vec<i64> = vec![i64::from(channels)];
    shape.extend(
        axes.iter()
            .map(|a| i64::from(a.highest_value().unwrap_or(0))),
    );
    shape.extend([
        i64::from(bbox.width.wrapping_add(bbox.top_left.x) / mag.x),
        i64::from(bbox.height.wrapping_add(bbox.top_left.y) / mag.y),
        i64::from(bbox.depth.wrapping_add(bbox.top_left.z) / mag.z),
    ]);
    let mut chunk_shape: Vec<i64> = vec![i64::from(channels)];
    chunk_shape.extend(axes.iter().map(|_| 1));
    chunk_shape.extend([i64::from(BUCKET_LENGTH); 3]);
    let rank = axes.len() + 4;
    let order: Vec<usize> = (0..rank).rev().collect();
    let mut dimension_names = vec!["c".to_owned()];
    dimension_names.extend(axes.iter().map(|a| a.name.clone()));
    dimension_names.extend(["x", "y", "z"].map(str::to_owned));
    json!({
        "zarr_format": 3,
        "node_type": "array",
        "shape": shape,
        "data_type": dtype,
        "chunk_grid": {"name": "regular", "configuration": {"chunk_shape": chunk_shape}},
        "chunk_key_encoding": {"name": "v2", "configuration": {"separator": "."}},
        "fill_value": 0,
        "attributes": Map::new(),
        "codecs": [
            {"name": "transpose", "configuration": {"order": order}},
            {"name": "bytes", "configuration": {"endian": "little"}},
        ],
        "dimension_names": dimension_names,
    })
}

/// Scala `convertLayerToZarrLayer`: the layer as served under `/zarr` (v2) or `/zarr3`.
pub fn convert_layer_to_zarr_layer(layer: &StaticLayer, zarr_version: u8) -> DsResult<StaticLayer> {
    let rank = layer.additional_axes.as_ref().map_or(0, Vec::len) as i32 + 4;
    let mags = layer
        .sorted_mags()
        .into_iter()
        .map(|mag| {
            Ok(MagLocator {
                path: Some(UPath::parse(&format!(
                    "./{}/{}",
                    layer.name,
                    mag.to_mag_literal(true)
                ))?),
                axis_order: Some(AxisOrder::c_additional_xyz(rank)),
                ..MagLocator::new(mag)
            })
        })
        .collect::<DsResult<Vec<_>>>()?;
    Ok(StaticLayer {
        data_format: if zarr_version == 2 {
            DataFormat::Zarr
        } else {
            DataFormat::Zarr3
        },
        mags,
        // Scala builds a new Static*Layer without attachments.
        attachments: None,
        additional_axes: layer
            .additional_axes
            .as_deref()
            .map(reorder_additional_axes),
        ..layer.clone()
    })
}

/// Twirl `HtmlFormat.escape`.
fn escape_html(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#x27;"),
            '&' => out.push_str("&amp;"),
            other => out.push(other),
        }
    }
    out
}

/// Scala `views.html.datastoreZarrDatasourceDir(kind, name, folderContents)`.
pub fn directory_html(kind: &str, name: &str, folder_contents: &[String]) -> String {
    let kind = escape_html(kind);
    let name = escape_html(name);
    let items: String = folder_contents
        .iter()
        .map(|entry| {
            let entry = escape_html(entry);
            format!("\n        <li><a href=\"{entry}\">{entry}</a></li>\n      ")
        })
        .collect();
    format!(
        r#"
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>WEBKNOSSOS {kind}</title>
    <meta name="robot" content="noindex" />
    <script type="text/javascript">
      // forward to path with trailing slash
      if (!window.location.pathname.endsWith('/')) {{
        var url = window.location.protocol + '//' +
                  window.location.host +
                  window.location.pathname + '/' +
                  window.location.search;
        window.location.replace(url);
      }}
    </script>

    <style>
      * {{
        font-family: "Monospaced Number", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
        "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Helvetica, Arial,
        sans-serif;
        text-align: center
      }}

      ul {{
        list-style: none;
      }}

      p#hint {{
        color: #777;
        margin-top: 4em
      }}
    </style>
  </head>
  <body>
    <p id="hint">This is the WEBKNOSSOS {kind} “{name}” folder.</p>
    <p>The following are the contents of the folder:</p>
    <ul>
      {items}
    </ul>
  </body>
</html>
"#
    )
}

#[cfg(test)]
mod tests {
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
}
