//! Scala `NeuroglancerUriExplorer`.

use futures::future::join_all;
use serde_json::{Map, Value, json};

use crate::{
    datavault::VaultPath,
    error::{DsError, DsResult},
    models::{StaticLayer, UPath, Vec3Int, VoxelSize},
};
use webknossos_common::explore_layers::{Explored, make_layer_names_unique};

use super::remote_layer_explorer::{ExploreContext, Explorer};

/// Scala `extractRawFragment`: the part after the first `#!`.
pub(super) fn raw_fragment(uri: &str) -> Option<&str> {
    uri.split_once("#!").map(|(_, f)| f)
}

/// Java `URLDecoder.decode` with `+` preserved (pre-escaped to `%2B`).
fn decode_preserving_plus(value: &str) -> Option<String> {
    let escaped = value.replace('+', "%2B");
    let bytes = escaped.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Scala `parseFragmentAsJson`: as-is, then decoded once, then twice.
pub(super) fn parse_fragment(raw: &str) -> Option<Map<String, Value>> {
    let parse = |s: &str| match serde_json::from_str::<Value>(s) {
        Ok(Value::Object(o)) => Some(o),
        _ => None,
    };
    parse(raw).or_else(|| {
        let once = decode_preserving_plus(raw)?;
        parse(&once).or_else(|| parse(&decode_preserving_plus(&once)?))
    })
}

/// Scala `extractPrimarySourceUrl`.
pub(super) fn primary_source_url(source: &Value) -> DsResult<String> {
    match source {
        Value::String(url) => Ok(url.clone()),
        Value::Object(o) => o
            .get("url")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| DsError::failure("'url' is undefined")),
        Value::Array(values) if !values.is_empty() => primary_source_url(&values[0]),
        _ => Err(DsError::failure("Neuroglancer layer has no valid 'source'")),
    }
}

async fn first_success(
    ctx: &ExploreContext,
    path: &VaultPath,
    explorers: &[Explorer],
) -> DsResult<Vec<Explored>> {
    let results = join_all(explorers.iter().map(|e| e.explore(ctx, path, None))).await;
    let mut last = DsError::empty();
    for result in results {
        match result {
            Ok(layers) => return Ok(layers),
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn explore_layer(ctx: &ExploreContext, spec: &Value) -> DsResult<Vec<Explored>> {
    let object = spec
        .as_object()
        .ok_or_else(|| DsError::failure("expected a JSON object"))?;
    let source_url = primary_source_url(object.get("source").unwrap_or(&Value::Null))?;
    let layer_type = source_url
        .split_once("://")
        .map(|(s, _)| s)
        .unwrap_or_default()
        .to_owned();
    let name = object
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| DsError::failure("'name' is undefined"))?;
    let rest = source_url.get(layer_type.len() + 3..).unwrap_or_default();
    let upath = UPath::parse(rest)?;
    let path = ctx
        .vaults
        .vault_path_for(&upath)
        .await
        .map_err(|e| e.wrap("Failed to set up remote file system"))?;
    let opacity = object.get("opacity").and_then(Value::as_f64).unwrap_or(1.0);
    let mut view = Map::new();
    view.insert("alpha".into(), json!(opacity * 100.0));
    if let Some(range) = object
        .get("shaderControls")
        .and_then(|s| s.get("normalized"))
        .and_then(|n| n.get("range"))
        .filter(|r| r.is_array())
    {
        view.insert("intensityRange".into(), range.clone());
    }
    let _ = name;
    let explored = match layer_type.as_str() {
        "n5" => {
            first_success(
                ctx,
                &path,
                &[
                    Explorer::N5Array,
                    Explorer::N5Multiscales,
                    Explorer::N5CompactMultiscales,
                ],
            )
            .await?
        }
        "precomputed" => Explorer::Precomputed.explore(ctx, &path, None).await?,
        "zarr" | "zarr2" => {
            first_success(
                ctx,
                &path,
                &[
                    Explorer::NgffV0_4,
                    Explorer::NgffV0_5,
                    Explorer::ZarrArray(Vec3Int::new(1, 1, 1)),
                ],
            )
            .await?
        }
        "zarr3" => Explorer::Zarr3Array.explore(ctx, &path, None).await?,
        other => {
            return Err(DsError::failure(format!(
                "Can not explore layer of {other} type"
            )));
        }
    };
    Ok(explored
        .into_iter()
        .map(|(mut l, v)| {
            l.default_view_configuration = Some(view.clone());
            (l, v)
        })
        .collect())
}

/// Scala `NeuroglancerUriExplorer`.
pub(super) async fn explore_uri(
    ctx: &ExploreContext,
    path: &VaultPath,
    credential_id: Option<&str>,
) -> DsResult<Vec<Explored>> {
    let uri = path.to_string();
    let raw = raw_fragment(&uri).ok_or_else(|| {
        DsError::failure("URI has no matching fragment part")
            .wrap("URI has no matching fragment part")
    })?;
    let spec =
        parse_fragment(raw).ok_or_else(|| DsError::failure("Did not find JSON object in URI"))?;
    let layers = spec
        .get("layers")
        .and_then(Value::as_array)
        .ok_or_else(|| DsError::failure("'layers' is undefined"))?;
    if credential_id.is_some() {
        return Err(DsError::failure(
            "Neuroglancer URI Explorer does not support credentials",
        ));
    }
    let explored = join_all(layers.iter().map(|l| explore_layer(ctx, l))).await;
    let mut all = Vec::new();
    for result in explored {
        all.extend(result?);
    }
    let (layers, sizes): (Vec<StaticLayer>, Vec<VoxelSize>) = all.into_iter().unzip();
    Ok(make_layer_names_unique(layers)
        .into_iter()
        .zip(sizes)
        .collect())
}
