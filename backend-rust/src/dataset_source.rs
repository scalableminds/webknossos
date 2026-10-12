//! Typed UsableDataSource as accepted by Play's JSON reads, rendered like
//! its writes, and persisted like DatasetLayerDAO.updateLayers.
use serde_json::{Map, Value, json};

use crate::error::{ApiError, ApiResult};

const DATA_FORMATS: &[&str] = &[
    "wkw",
    "zarr",
    "zarr3",
    "n5",
    "neuroglancerPrecomputed",
    "tracing",
];
const ELEMENT_CLASSES: &[&str] = &[
    "uint8", "uint16", "uint24", "uint32", "uint64", "float", "double", "int8", "int16", "int32",
    "int64",
];
const ATTACHMENT_FORMATS: &[&str] = &["hdf5", "json", "zarr3", "neuroglancerPrecomputed"];
const LENGTH_UNITS: &[&str] = &[
    "yoctometer",
    "zeptometer",
    "attometer",
    "femtometer",
    "picometer",
    "nanometer",
    "micrometer",
    "millimeter",
    "centimeter",
    "decimeter",
    "meter",
    "hectometer",
    "kilometer",
    "megameter",
    "gigameter",
    "terameter",
    "petameter",
    "exameter",
    "zettameter",
    "yottameter",
    "angstrom",
    "inch",
    "foot",
    "yard",
    "mile",
    "parsec",
];

pub(crate) type ParseResult<T> = Result<T, String>;

pub(crate) fn invalid_body(_: String) -> ApiError {
    ApiError::bad_request("Invalid JSON request body.")
}

// ---------------------------------------------------------------- UPath

/// java.nio Path.normalize() on a Unix path string.
fn normalize_nio(path: &str) -> String {
    let absolute = path.starts_with('/');
    let mut parts: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => match parts.last() {
                Some(last) if *last != ".." => {
                    parts.pop();
                }
                _ if absolute => {}
                _ => parts.push(".."),
            },
            other => parts.push(other),
        }
    }
    let joined = parts.join("/");
    if absolute {
        format!("/{joined}")
    } else {
        joined
    }
}

/// UPath.fromString(...).toString: local paths are nio-normalized (relative
/// ones get a `./` prefix, `file://` is dropped), remote paths resolve `.`/`..`
/// segments, zip entry references keep their inner path.
pub(crate) fn normalize_upath(literal: &str) -> ParseResult<String> {
    if literal.contains('\0') {
        return Err("Invalid UPath".into());
    }
    let with_path = literal.find("|zip:");
    if with_path.is_some() || literal.ends_with("|zip") {
        if literal.matches("|zip").count() != 1 {
            return Err("Nested zip paths are not supported".into());
        }
        let (outer, inner) = match with_path {
            Some(index) => (&literal[..index], &literal[index + "|zip:".len()..]),
            None => (&literal[..literal.len() - "|zip".len()], ""),
        };
        if outer.is_empty() || inner.starts_with("//") {
            return Err("Invalid zip path".into());
        }
        let outer = normalize_upath(outer)?;
        let inner = inner.strip_prefix('/').unwrap_or(inner);
        return Ok(if inner.is_empty() {
            format!("{outer}|zip")
        } else {
            format!("{outer}|zip:{inner}")
        });
    }
    match literal.split_once("://") {
        None => {
            let normalized = normalize_nio(literal);
            Ok(if normalized.starts_with('/') {
                normalized
            } else {
                format!("./{normalized}")
            })
        }
        Some((scheme, rest)) if scheme.contains("file") => {
            let normalized = normalize_nio(rest);
            if !normalized.starts_with('/') {
                return Err("Relative file UPath".into());
            }
            Ok(normalized)
        }
        Some((scheme, rest)) => {
            let mut segments: Vec<&str> = Vec::new();
            for segment in rest.split('/') {
                match segment {
                    "." => {}
                    ".." => {
                        if segments.len() >= 2 {
                            segments.pop();
                        }
                    }
                    other => segments.push(other),
                }
            }
            Ok(format!("{scheme}://{}", segments.join("/")))
        }
    }
}

/// UPath `/`: append a (relative) child to a normalized UPath.
pub(crate) fn upath_join(base: &str, child: &str) -> ParseResult<String> {
    if let Some(index) = base.find("|zip") {
        let (outer, rest) = base.split_at(index);
        let inner = rest
            .strip_prefix("|zip:")
            .or(rest.strip_prefix("|zip"))
            .unwrap_or("");
        let mut joined = format!("{inner}/{child}");
        while joined.contains("//") {
            joined = joined.replace("//", "/");
        }
        let joined = joined.strip_prefix('/').unwrap_or(&joined);
        return Ok(format!("{outer}|zip:{joined}"));
    }
    if base.contains("://") && !upath_is_local(base) {
        let trimmed = base.strip_suffix('/').unwrap_or(base);
        return normalize_upath(&format!("{trimmed}/{child}"));
    }
    if child.starts_with('/') {
        return normalize_upath(child);
    }
    normalize_upath(&format!("{base}/{child}"))
}

/// UPath.toAbsolute: relative local paths resolve against the working directory.
pub(crate) fn upath_to_absolute(path: &str) -> ParseResult<String> {
    if upath_is_local(path) && !path.starts_with('/') && !path.contains("://") {
        let cwd = std::env::current_dir().map_err(|_| "cwd".to_owned())?;
        return normalize_upath(&format!("{}/{path}", cwd.display()));
    }
    Ok(path.to_owned())
}

pub(crate) fn upath_is_local(path: &str) -> bool {
    let outer = path.split("|zip").next().unwrap_or(path);
    match outer.split_once("://") {
        None => true,
        Some((scheme, _)) => scheme.contains("file"),
    }
}

// ---------------------------------------------------------------- model

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct DataSource {
    pub directory_name: String,
    pub organization: String,
    pub layers: Vec<Layer>,
    pub factor: [f64; 3],
    pub unit: String,
    pub default_view_configuration: Option<Map<String, Value>>,
    pub status_opt: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Category {
    Color,
    Segmentation,
}

impl Category {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Color => "color",
            Self::Segmentation => "segmentation",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Layer {
    pub name: String,
    pub category: Category,
    pub data_format: String,
    pub bounding_box: [i32; 6],
    pub element_class: String,
    pub mags: Vec<Mag>,
    pub default_view_configuration: Option<Map<String, Value>>,
    pub admin_view_configuration: Option<Map<String, Value>>,
    pub coordinate_transformations: Option<Vec<Transform>>,
    pub additional_axes: Option<Vec<Axis>>,
    pub attachments: Option<Attachments>,
    pub largest_segment_id: Option<i64>,
    pub mappings: Option<Vec<String>>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Mag {
    pub mag: [i32; 3],
    pub path: Option<String>,
    pub axis_order: Option<Value>,
    pub channel_index: Option<i32>,
    pub credential_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Transform {
    pub typ: String,
    pub matrix: Option<Value>,
    pub correspondences: Option<Value>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Axis {
    pub name: String,
    pub bounds: Vec<i32>,
    pub index: i32,
}

#[derive(Clone, Debug, PartialEq, Default)]
pub(crate) struct Attachments {
    pub meshes: Vec<Attachment>,
    pub agglomerates: Vec<Attachment>,
    pub segment_index: Option<Attachment>,
    pub connectomes: Vec<Attachment>,
    pub cumsum: Option<Attachment>,
    pub segment_statistics: Option<Attachment>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Attachment {
    pub name: String,
    pub path: String,
    pub data_format: String,
    pub credential_id: Option<String>,
}

impl Attachments {
    /// (type, attachment) in DatasetLayerAttachmentDAO.updateAttachments order.
    pub(crate) fn typed(&self) -> Vec<(&'static str, &Attachment)> {
        let mut result: Vec<(&'static str, &Attachment)> = Vec::new();
        result.extend(self.agglomerates.iter().map(|a| ("agglomerate", a)));
        result.extend(self.connectomes.iter().map(|a| ("connectome", a)));
        result.extend(self.segment_index.iter().map(|a| ("segmentIndex", a)));
        result.extend(self.meshes.iter().map(|a| ("mesh", a)));
        result.extend(self.cumsum.iter().map(|a| ("cumsum", a)));
        result.extend(
            self.segment_statistics
                .iter()
                .map(|a| ("segmentStatistics", a)),
        );
        result
    }
    pub(crate) fn is_empty(&self) -> bool {
        self.typed().is_empty()
    }
    pub(crate) fn contains_duplicate_names(&self) -> bool {
        fn duplicates(list: &[Attachment]) -> bool {
            let mut seen = std::collections::HashSet::new();
            !list.iter().all(|a| seen.insert(&a.name))
        }
        duplicates(&self.meshes) || duplicates(&self.agglomerates) || duplicates(&self.connectomes)
    }
    /// DataLayerAttachments.dropMissing.
    pub(crate) fn drop_missing(&self, other: &Attachments) -> Option<Attachments> {
        fn keep(list: &[Attachment], other: &[Attachment]) -> Vec<Attachment> {
            list.iter()
                .filter(|a| other.iter().any(|o| o.name == a.name))
                .cloned()
                .collect()
        }
        fn keep_one(one: &Option<Attachment>, other: &Option<Attachment>) -> Option<Attachment> {
            one.clone()
                .filter(|a| other.as_ref().is_some_and(|o| o.name == a.name))
        }
        let filtered = Attachments {
            meshes: keep(&self.meshes, &other.meshes),
            agglomerates: keep(&self.agglomerates, &other.agglomerates),
            segment_index: keep_one(&self.segment_index, &other.segment_index),
            connectomes: keep(&self.connectomes, &other.connectomes),
            cumsum: keep_one(&self.cumsum, &other.cumsum),
            segment_statistics: keep_one(&self.segment_statistics, &other.segment_statistics),
        };
        (!filtered.is_empty()).then_some(filtered)
    }
    /// Mutable access to every attachment with its type.
    pub(crate) fn for_each_mut(&mut self, mut f: impl FnMut(&str, &mut Attachment)) {
        for a in &mut self.meshes {
            f("mesh", a);
        }
        for a in &mut self.agglomerates {
            f("agglomerate", a);
        }
        if let Some(a) = &mut self.segment_index {
            f("segmentIndex", a);
        }
        for a in &mut self.connectomes {
            f("connectome", a);
        }
        if let Some(a) = &mut self.cumsum {
            f("cumsum", a);
        }
        if let Some(a) = &mut self.segment_statistics {
            f("segmentStatistics", a);
        }
    }
    /// DataLayerAttachments.withAdded.
    pub(crate) fn add(&mut self, typ: &str, attachment: Attachment) {
        match typ {
            "mesh" => self.meshes.push(attachment),
            "agglomerate" => self.agglomerates.push(attachment),
            "connectome" => self.connectomes.push(attachment),
            "segmentIndex" => self.segment_index = Some(attachment),
            "cumsum" => self.cumsum = Some(attachment),
            _ => self.segment_statistics = Some(attachment),
        }
    }
}

impl Layer {
    pub(crate) fn explicit_paths(&self) -> Vec<String> {
        let mut paths: Vec<String> = self.mags.iter().filter_map(|m| m.path.clone()).collect();
        if let Some(attachments) = &self.attachments {
            paths.extend(attachments.typed().into_iter().map(|(_, a)| a.path.clone()));
        }
        paths
    }
}

impl DataSource {
    pub(crate) fn explicit_paths(&self) -> Vec<String> {
        self.layers.iter().flat_map(Layer::explicit_paths).collect()
    }
}

// ---------------------------------------------------------------- reads

fn field<'a>(object: &'a Value, key: &str) -> Option<&'a Value> {
    object.get(key).filter(|v| !v.is_null())
}

pub(crate) fn int(value: &Value) -> ParseResult<i32> {
    let number = value.as_f64().ok_or("expected int")?;
    if value.is_number()
        && number.fract() == 0.0
        && number >= f64::from(i32::MIN)
        && number <= f64::from(i32::MAX)
    {
        Ok(number as i32)
    } else {
        Err("expected int".into())
    }
}

fn string(value: Option<&Value>, what: &str) -> ParseResult<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| format!("expected string {what}"))
}

fn optional_string(value: Option<&Value>) -> ParseResult<Option<String>> {
    value
        .map(|v| {
            v.as_str()
                .map(str::to_owned)
                .ok_or("expected string".into())
        })
        .transpose()
}

fn enumeration(value: Option<&Value>, allowed: &[&str], what: &str) -> ParseResult<String> {
    let value = string(value, what)?;
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(format!("invalid {what}"))
    }
}

pub(crate) fn vec3_int(value: &Value) -> ParseResult<[i32; 3]> {
    let array = value
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or("expected vec3")?;
    Ok([int(&array[0])?, int(&array[1])?, int(&array[2])?])
}

/// MagFormatHelper: a scalar mag is isotropic.
pub(crate) fn mag_vec(value: &Value) -> ParseResult<[i32; 3]> {
    int(value).map(|m| [m, m, m]).or_else(|_| vec3_int(value))
}

fn vec3_double(value: &Value) -> ParseResult<[f64; 3]> {
    let array = value
        .as_array()
        .filter(|a| a.len() == 3)
        .ok_or("expected vec3 double")?;
    let number = |v: &Value| v.as_f64().ok_or_else(|| "expected number".to_owned());
    Ok([number(&array[0])?, number(&array[1])?, number(&array[2])?])
}

pub(crate) fn bounding_box(value: &Value) -> ParseResult<[i32; 6]> {
    let top_left = vec3_int(value.get("topLeft").ok_or("missing topLeft")?)?;
    let get = |key: &str| int(value.get(key).ok_or_else(|| format!("missing {key}"))?);
    Ok([
        top_left[0],
        top_left[1],
        top_left[2],
        get("width")?,
        get("height")?,
        get("depth")?,
    ])
}

fn view_configuration(value: Option<&Value>) -> ParseResult<Option<Map<String, Value>>> {
    match value {
        None => Ok(None),
        Some(Value::Object(map)) => Ok((!map.is_empty()).then(|| map.clone())),
        Some(_) => Err("expected object".into()),
    }
}

fn axis_order(value: &Value) -> ParseResult<Value> {
    let required = |key: &str| int(value.get(key).ok_or("missing axis")?);
    let optional = |key: &str| field(value, key).map(int).transpose();
    let mut result = json!({"x": required("x")?, "y": required("y")?});
    if let Some(z) = optional("z")? {
        result["z"] = json!(z);
    }
    if let Some(c) = optional("c")? {
        result["c"] = json!(c);
    }
    Ok(result)
}

fn mag_locator(value: &Value) -> ParseResult<Mag> {
    Ok(Mag {
        mag: mag_vec(value.get("mag").ok_or("missing mag")?)?,
        path: optional_string(field(value, "path"))?
            .map(|p| normalize_upath(&p))
            .transpose()?,
        axis_order: field(value, "axisOrder").map(axis_order).transpose()?,
        channel_index: field(value, "channelIndex").map(int).transpose()?,
        credential_id: optional_string(field(value, "credentialId"))?,
    })
}

fn wkw_resolution(value: &Value) -> ParseResult<Mag> {
    if let Some(cube) = field(value, "cubeLength") {
        int(cube)?;
    }
    Ok(Mag {
        mag: mag_vec(value.get("resolution").ok_or("missing resolution")?)?,
        path: optional_string(field(value, "path"))?
            .map(|p| normalize_upath(&p))
            .transpose()?,
        axis_order: None,
        channel_index: None,
        credential_id: optional_string(field(value, "credentialId"))?,
    })
}

fn list<T>(value: &Value, parse: impl Fn(&Value) -> ParseResult<T>) -> ParseResult<Vec<T>> {
    value
        .as_array()
        .ok_or("expected array")?
        .iter()
        .map(parse)
        .collect()
}

pub(crate) fn transform(value: &Value) -> ParseResult<Transform> {
    let typ = enumeration(value.get("type"), &["affine", "thin_plate_spline"], "type")?;
    let matrix = field(value, "matrix")
        .map(|m| {
            list(m, |row| {
                list(row, |v| v.as_f64().ok_or_else(|| "number".to_owned()))
            })
            .map(|_| m.clone())
        })
        .transpose()?;
    let correspondences = field(value, "correspondences")
        .map(|c| -> ParseResult<Value> {
            let source = list(c.get("source").ok_or("source")?, vec3_double)?;
            let target = list(c.get("target").ok_or("target")?, vec3_double)?;
            Ok(json!({"source": source, "target": target}))
        })
        .transpose()?;
    Ok(Transform {
        typ,
        matrix,
        correspondences,
    })
}

fn additional_axis(value: &Value) -> ParseResult<Axis> {
    let bounds = list(value.get("bounds").ok_or("bounds")?, int)?;
    if bounds.len() < 2 {
        return Err("bounds".into());
    }
    Ok(Axis {
        name: string(value.get("name"), "name")?,
        bounds,
        index: int(value.get("index").ok_or("index")?)?,
    })
}

fn attachment(value: &Value) -> ParseResult<Attachment> {
    Ok(Attachment {
        name: string(value.get("name"), "name")?,
        path: normalize_upath(&string(value.get("path"), "path")?)?,
        data_format: enumeration(value.get("dataFormat"), ATTACHMENT_FORMATS, "dataFormat")?,
        credential_id: optional_string(field(value, "credentialId"))?,
    })
}

fn attachments(value: &Value) -> ParseResult<Attachments> {
    if !value.is_object() {
        return Err("expected object".into());
    }
    let many = |key: &str| -> ParseResult<Vec<Attachment>> {
        field(value, key)
            .map(|v| list(v, attachment))
            .transpose()
            .map(Option::unwrap_or_default)
    };
    let one = |key: &str| field(value, key).map(attachment).transpose();
    Ok(Attachments {
        meshes: many("meshes")?,
        agglomerates: many("agglomerates")?,
        segment_index: one("segmentIndex")?,
        connectomes: many("connectomes")?,
        cumsum: one("cumsum")?,
        segment_statistics: one("segmentStatistics")?,
    })
}

/// UnsignedLong reads: bigint envelope or plain number.
fn unsigned_long(value: &Value) -> ParseResult<i64> {
    if let Some(object) = value.as_object() {
        if object.get("customJsonEncoding").and_then(Value::as_str) == Some("bigint") {
            let text = object
                .get("value")
                .and_then(Value::as_str)
                .ok_or("bigint value")?;
            return text
                .parse::<u64>()
                .map(|v| v as i64)
                .map_err(|_| "bigint".into());
        }
        return Err("bigint".into());
    }
    if let Some(v) = value.as_i64() {
        return Ok(v);
    }
    if let Some(v) = value.as_u64() {
        return Ok(v as i64);
    }
    value
        .as_f64()
        .map(|v| v as i64)
        .ok_or_else(|| "expected number".into())
}

pub(crate) fn parse_layer(value: &Value) -> ParseResult<Layer> {
    let category = match string(value.get("category"), "category")?.as_str() {
        "color" => Category::Color,
        "segmentation" => Category::Segmentation,
        _ => return Err("invalid category".into()),
    };
    let mags = match value.get("mags").map(|m| list(m, mag_locator)) {
        Some(Ok(mags)) => mags,
        _ => list(
            value
                .get("wkwResolutions")
                .ok_or("mags or wkwResolutions")?,
            wkw_resolution,
        )?,
    };
    let segmentation = category == Category::Segmentation;
    Ok(Layer {
        data_format: enumeration(value.get("dataFormat"), DATA_FORMATS, "dataFormat")?,
        name: string(value.get("name"), "name")?,
        largest_segment_id: if segmentation {
            field(value, "largestSegmentId")
                .map(unsigned_long)
                .transpose()?
        } else {
            None
        },
        mappings: if segmentation {
            field(value, "mappings")
                .map(|m| {
                    list(m, |v| {
                        v.as_str()
                            .map(str::to_owned)
                            .ok_or_else(|| "string".to_owned())
                    })
                })
                .transpose()?
                .map(|mut names| {
                    names.sort();
                    names.dedup();
                    names
                })
        } else {
            None
        },
        bounding_box: bounding_box(value.get("boundingBox").ok_or("boundingBox")?)?,
        element_class: enumeration(value.get("elementClass"), ELEMENT_CLASSES, "elementClass")?,
        default_view_configuration: view_configuration(field(value, "defaultViewConfiguration"))?,
        admin_view_configuration: view_configuration(field(value, "adminViewConfiguration"))?,
        coordinate_transformations: field(value, "coordinateTransformations")
            .map(|t| list(t, transform))
            .transpose()?
            .filter(|t| !t.is_empty()),
        additional_axes: field(value, "additionalAxes")
            .map(|a| list(a, additional_axis))
            .transpose()?,
        attachments: field(value, "attachments").map(attachments).transpose()?,
        category,
        mags,
    })
}

/// VoxelSize reads: a bare factor (nanometer) or `{factor, unit}`.
pub(crate) fn voxel_size(scale: &Value) -> ParseResult<([f64; 3], String)> {
    match vec3_double(scale) {
        Ok(factor) => Ok((factor, "nanometer".to_owned())),
        Err(_) => Ok((
            vec3_double(scale.get("factor").ok_or("factor")?)?,
            enumeration(scale.get("unit"), LENGTH_UNITS, "unit")?,
        )),
    }
}

/// LengthUnit.toNanometer.
pub(crate) fn nanometers_per_unit(unit: &str) -> f64 {
    match unit {
        "yoctometer" => 1e-15,
        "zeptometer" => 1e-12,
        "attometer" => 1e-9,
        "femtometer" => 1e-6,
        "picometer" => 1e-3,
        "micrometer" => 1e3,
        "millimeter" => 1e6,
        "centimeter" => 1e7,
        "decimeter" => 1e8,
        "meter" => 1e9,
        "hectometer" => 1e11,
        "kilometer" => 1e12,
        "megameter" => 1e15,
        "gigameter" => 1e18,
        "terameter" => 1e21,
        "petameter" => 1e24,
        "exameter" => 1e27,
        "zettameter" => 1e30,
        "yottameter" => 1e33,
        "angstrom" => 0.1,
        "inch" => 25400000.0,
        "foot" => 304800000.0,
        "yard" => 914400000.0,
        "mile" => 1609344000000.0,
        "parsec" => 3.085677581e25,
        _ => 1.0,
    }
}

/// UsableDataSource reads (JsonAutoFormat): id, dataLayers and scale required.
pub(crate) fn parse_data_source(value: &Value) -> ParseResult<DataSource> {
    let id = value.get("id").ok_or("id")?;
    let (factor, unit) = voxel_size(value.get("scale").ok_or("scale")?)?;
    Ok(DataSource {
        directory_name: string(id.get("name"), "name")?,
        organization: string(id.get("team"), "team")?,
        layers: list(value.get("dataLayers").ok_or("dataLayers")?, parse_layer)?,
        factor,
        unit,
        default_view_configuration: match field(value, "defaultViewConfiguration") {
            None => None,
            Some(Value::Object(map)) => Some(map.clone()),
            Some(_) => return Err("defaultViewConfiguration".into()),
        },
        status_opt: optional_string(field(value, "statusOpt"))?,
    })
}

/// UnusableDataSource as read by Play (JsonAutoFormat): id and status are
/// required, layers/scale/existingDataSourceProperties are optional.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct UnusableDataSource {
    pub directory_name: String,
    pub organization: String,
    pub layers: Option<Vec<Layer>>,
    pub status: String,
    pub voxel_size: Option<([f64; 3], String)>,
    pub existing_properties: Option<Value>,
}

/// The polymorphic DataSource of Play's `dataSourceFormat`.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum AnyDataSource {
    Usable(DataSource),
    Unusable(UnusableDataSource),
}

fn parse_unusable_data_source(value: &Value) -> ParseResult<UnusableDataSource> {
    let id = value.get("id").ok_or("id")?;
    Ok(UnusableDataSource {
        directory_name: string(id.get("name"), "name")?,
        organization: string(id.get("team"), "team")?,
        status: string(value.get("status"), "status")?,
        layers: field(value, "dataLayers")
            .map(|l| list(l, parse_layer))
            .transpose()?,
        voxel_size: field(value, "scale").map(voxel_size).transpose()?,
        existing_properties: field(value, "existingDataSourceProperties").cloned(),
    })
}

/// DataSource.dataSourceFormat reads: UnusableDataSource first, then usable.
pub(crate) fn parse_any_data_source(value: &Value) -> ParseResult<AnyDataSource> {
    parse_unusable_data_source(value)
        .map(AnyDataSource::Unusable)
        .or_else(|_| parse_data_source(value).map(AnyDataSource::Usable))
}

impl AnyDataSource {
    pub(crate) fn directory_name(&self) -> &str {
        match self {
            Self::Usable(s) => &s.directory_name,
            Self::Unusable(s) => &s.directory_name,
        }
    }
    pub(crate) fn organization(&self) -> &str {
        match self {
            Self::Usable(s) => &s.organization,
            Self::Unusable(s) => &s.organization,
        }
    }
    pub(crate) fn is_usable(&self) -> bool {
        matches!(self, Self::Usable(_))
    }
    /// DataSource.allLayers.
    pub(crate) fn layers(&self) -> &[Layer] {
        match self {
            Self::Usable(s) => &s.layers,
            Self::Unusable(s) => s.layers.as_deref().unwrap_or_default(),
        }
    }
    pub(crate) fn voxel_size(&self) -> Option<([f64; 3], &str)> {
        match self {
            Self::Usable(s) => Some((s.factor, &s.unit)),
            Self::Unusable(s) => s.voxel_size.as_ref().map(|(f, u)| (*f, u.as_str())),
        }
    }
    /// `statusOpt.getOrElse("")`.
    pub(crate) fn status(&self) -> &str {
        match self {
            Self::Usable(s) => s.status_opt.as_deref().unwrap_or(""),
            Self::Unusable(s) => &s.status,
        }
    }
    pub(crate) fn default_view_configuration(&self) -> Option<&Map<String, Value>> {
        match self {
            Self::Usable(s) => s.default_view_configuration.as_ref(),
            Self::Unusable(_) => None,
        }
    }
    /// The same data in the usable shape, as accepted by the dataset
    /// insertion helpers (voxel size and usability are passed separately).
    pub(crate) fn as_usable_shape(&self) -> DataSource {
        match self {
            Self::Usable(s) => s.clone(),
            Self::Unusable(s) => DataSource {
                directory_name: s.directory_name.clone(),
                organization: s.organization.clone(),
                layers: self.layers().to_vec(),
                factor: s.voxel_size.as_ref().map(|v| v.0).unwrap_or([1.0; 3]),
                unit: s
                    .voxel_size
                    .as_ref()
                    .map_or("nanometer".to_owned(), |v| v.1.clone()),
                default_view_configuration: None,
                status_opt: Some(s.status.clone()),
            },
        }
    }
    /// Json.toJson(DataSource).
    pub(crate) fn to_json(&self) -> Value {
        match self {
            Self::Usable(s) => data_source_json(s),
            Self::Unusable(s) => {
                let mut result = json!({
                    "id": {"name": s.directory_name, "team": s.organization},
                    "status": s.status,
                });
                if let Some(layers) = &s.layers {
                    result["dataLayers"] = json!(layers.iter().map(layer_json).collect::<Vec<_>>());
                }
                if let Some((factor, unit)) = &s.voxel_size {
                    result["scale"] = json!({"factor": factor, "unit": unit});
                }
                if let Some(existing) = &s.existing_properties {
                    result["existingDataSourceProperties"] = existing.clone();
                }
                result
            }
        }
    }
    /// Deterministic replacement for Scala's `DataSource.hashCode`, stored in
    /// `datasets.inboxSourceHash` so unchanged inbox reports can be skipped.
    /// The case-class hash cannot be reproduced; this hashes the canonical
    /// (sorted-key) JSON of the parsed data source instead. Hashes written by
    /// the Scala backend therefore never match, which costs exactly one
    /// rewrite per dataset on the first report after switching backends.
    pub(crate) fn inbox_source_hash(&self) -> i32 {
        use sha1::{Digest, Sha1};
        let canonical = serde_json::to_vec(&self.to_json()).unwrap_or_default();
        let digest = Sha1::digest(&canonical);
        i32::from_be_bytes([digest[0], digest[1], digest[2], digest[3]])
    }
}

// ---------------------------------------------------------------- writes

fn attachment_json(attachment: &Attachment) -> Value {
    let mut result = json!({"name": attachment.name, "path": attachment.path, "dataFormat": attachment.data_format});
    if let Some(id) = &attachment.credential_id {
        result["credentialId"] = json!(id);
    }
    result
}

pub(crate) fn layer_json(layer: &Layer) -> Value {
    let mags: Vec<Value> = layer
        .mags
        .iter()
        .map(|mag| {
            let mut result = json!({"mag": mag.mag});
            if let Some(path) = &mag.path {
                result["path"] = json!(path);
            }
            if let Some(order) = &mag.axis_order {
                result["axisOrder"] = order.clone();
            }
            if let Some(index) = mag.channel_index {
                result["channelIndex"] = json!(index);
            }
            if let Some(id) = &mag.credential_id {
                result["credentialId"] = json!(id);
            }
            result
        })
        .collect();
    let [x, y, z, width, height, depth] = layer.bounding_box;
    let mut result = json!({
        "category": layer.category.as_str(),
        "name": layer.name,
        "dataFormat": layer.data_format,
        "boundingBox": {"topLeft": [x, y, z], "width": width, "height": height, "depth": depth},
        "elementClass": layer.element_class,
        "mags": mags,
        "resolutions": layer.mags.iter().map(|m| m.mag).collect::<Vec<_>>(),
        "numChannels": if layer.element_class == "uint24" { 3 } else { 1 },
    });
    let object = result.as_object_mut().expect("object");
    if let Some(config) = &layer.default_view_configuration {
        object.insert(
            "defaultViewConfiguration".into(),
            Value::Object(config.clone()),
        );
    }
    if let Some(config) = &layer.admin_view_configuration {
        object.insert(
            "adminViewConfiguration".into(),
            Value::Object(config.clone()),
        );
    }
    if let Some(transforms) = &layer.coordinate_transformations {
        object.insert(
            "coordinateTransformations".into(),
            json!(
                transforms
                    .iter()
                    .map(|t| {
                        let mut value = json!({"type": t.typ});
                        if let Some(matrix) = &t.matrix {
                            value["matrix"] = matrix.clone();
                        }
                        if let Some(c) = &t.correspondences {
                            value["correspondences"] = c.clone();
                        }
                        value
                    })
                    .collect::<Vec<_>>()
            ),
        );
    }
    if let Some(axes) = &layer.additional_axes {
        object.insert(
            "additionalAxes".into(),
            json!(
                axes.iter()
                    .map(|a| json!({"name": a.name, "bounds": a.bounds, "index": a.index}))
                    .collect::<Vec<_>>()
            ),
        );
    }
    if let Some(attachments) = &layer.attachments {
        let many =
            |list: &[Attachment]| json!(list.iter().map(attachment_json).collect::<Vec<_>>());
        let mut value = json!({
            "meshes": many(&attachments.meshes),
            "agglomerates": many(&attachments.agglomerates),
            "connectomes": many(&attachments.connectomes),
        });
        for (key, one) in [
            ("segmentIndex", &attachments.segment_index),
            ("cumsum", &attachments.cumsum),
            ("segmentStatistics", &attachments.segment_statistics),
        ] {
            if let Some(attachment) = one {
                value[key] = attachment_json(attachment);
            }
        }
        object.insert("attachments".into(), value);
    }
    if let Some(id) = layer.largest_segment_id {
        object.insert(
            "largestSegmentId".into(),
            json!({"customJsonEncoding": "bigint", "value": (id as u64).to_string()}),
        );
    }
    if let Some(mappings) = &layer.mappings {
        object.insert("mappings".into(), json!(mappings));
    }
    result
}

/// Json.toJson(UsableDataSource).
pub(crate) fn data_source_json(source: &DataSource) -> Value {
    let mut result = json!({
        "id": {"name": source.directory_name, "team": source.organization},
        "dataLayers": source.layers.iter().map(layer_json).collect::<Vec<_>>(),
        "scale": {"factor": source.factor, "unit": source.unit},
    });
    if let Some(config) = &source.default_view_configuration {
        result["defaultViewConfiguration"] = Value::Object(config.clone());
    }
    if let Some(status) = &source.status_opt {
        result["statusOpt"] = json!(status);
    }
    result
}

/// DatasetService.dataSourceFor on a usable dataset, typed (real paths).
pub(crate) async fn load(pool: &sqlx::PgPool, dataset_id: &str) -> ApiResult<DataSource> {
    let rendered = crate::datasets::data_source_for_rpc(pool, dataset_id, true).await?;
    parse_data_source(&rendered).map_err(|_| ApiError::internal())
}

/// DatasetLayerDAO.updateLayers (mags, transforms, attachments and axes) in
/// the caller's transaction; pending upload mags/attachments are kept.
pub(crate) async fn write_layers(
    connection: &mut sqlx::PgConnection,
    dataset_id: &str,
    layers: &[Layer],
) -> ApiResult<()> {
    let names: Vec<&str> = layers.iter().map(|l| l.name.as_str()).collect();
    sqlx::query(
        "DELETE FROM webknossos.dataset_layers WHERE _dataset = $1 AND NOT (name = ANY($2))",
    )
    .bind(dataset_id)
    .bind(&names)
    .execute(&mut *connection)
    .await?;
    for layer in layers {
        let [x, y, z, width, height, depth] = layer.bounding_box.map(f64::from);
        let default = layer.default_view_configuration.clone().map(Value::Object);
        let admin = layer.admin_view_configuration.clone().map(Value::Object);
        let channels = if layer.element_class == "uint24" {
            3
        } else {
            1
        };
        match layer.category {
            Category::Segmentation => {
                sqlx::query(r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, largestSegmentId, mappings, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'segmentation', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12, $13, $14::webknossos.DATASET_LAYER_DATAFORMAT, $15)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, largestSegmentId = EXCLUDED.largestSegmentId, mappings = EXCLUDED.mappings,
                      defaultViewConfiguration = EXCLUDED.defaultViewConfiguration, adminViewConfiguration = EXCLUDED.adminViewConfiguration,
                      numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#)
                    .bind(dataset_id).bind(&layer.name).bind(&layer.element_class)
                    .bind(x).bind(y).bind(z).bind(width).bind(height).bind(depth)
                    .bind(layer.largest_segment_id).bind(layer.mappings.clone().unwrap_or_default())
                    .bind(default).bind(admin).bind(&layer.data_format).bind(channels)
                    .execute(&mut *connection).await?;
            }
            Category::Color => {
                sqlx::query(r#"INSERT INTO webknossos.dataset_layers(_dataset, name, category, elementClass, boundingBox, defaultViewConfiguration, adminViewConfiguration, dataFormat, numChannels)
                    VALUES ($1, $2, 'color', $3::webknossos.DATASET_LAYER_ELEMENT_CLASS, ROW($4,$5,$6,$7,$8,$9)::webknossos.BOUNDING_BOX, $10, $11, $12::webknossos.DATASET_LAYER_DATAFORMAT, $13)
                    ON CONFLICT (_dataset, name) DO UPDATE SET category = EXCLUDED.category, elementClass = EXCLUDED.elementClass,
                      boundingBox = EXCLUDED.boundingBox, defaultViewConfiguration = EXCLUDED.defaultViewConfiguration,
                      adminViewConfiguration = EXCLUDED.adminViewConfiguration, numChannels = EXCLUDED.numChannels, dataFormat = EXCLUDED.dataFormat"#)
                    .bind(dataset_id).bind(&layer.name).bind(&layer.element_class)
                    .bind(x).bind(y).bind(z).bind(width).bind(height).bind(depth)
                    .bind(default).bind(admin).bind(&layer.data_format).bind(channels)
                    .execute(&mut *connection).await?;
            }
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_mags WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(&mut *connection).await?;
    for layer in layers {
        for mag in &layer.mags {
            let [mx, my, mz] = mag.mag.map(f64::from);
            sqlx::query(r#"INSERT INTO webknossos.dataset_mags(_dataset, dataLayerName, mag, path, axisOrder, channelIndex, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, ROW($3,$4,$5)::webknossos.VECTOR3, $6, $7, $8, $9, false, false)"#)
                .bind(dataset_id).bind(&layer.name).bind(mx).bind(my).bind(mz)
                .bind(&mag.path).bind(&mag.axis_order).bind(mag.channel_index).bind(&mag.credential_id)
                .execute(&mut *connection).await?;
        }
    }
    sqlx::query(
        "DELETE FROM webknossos.dataset_layer_coordinateTransformations WHERE _dataset = $1",
    )
    .bind(dataset_id)
    .execute(&mut *connection)
    .await?;
    for layer in layers {
        for (index, transform) in layer
            .coordinate_transformations
            .iter()
            .flatten()
            .enumerate()
        {
            // Json.toJson(None) is a JSON null, not SQL NULL.
            sqlx::query("INSERT INTO webknossos.dataset_layer_coordinateTransformations(_dataset, layerName, type, matrix, correspondences, insertionOrderIndex) VALUES ($1, $2, $3, $4, $5, $6)")
                .bind(dataset_id).bind(&layer.name).bind(&transform.typ)
                .bind(transform.matrix.clone().unwrap_or(Value::Null))
                .bind(transform.correspondences.clone().unwrap_or(Value::Null))
                .bind(index as i32)
                .execute(&mut *connection).await?;
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_layer_attachments WHERE _dataset = $1 AND NOT uploadToPathIsPending AND NOT uploadIsPending")
        .bind(dataset_id).execute(&mut *connection).await?;
    for layer in layers {
        for (typ, attachment) in layer.attachments.iter().flat_map(Attachments::typed) {
            sqlx::query(r#"INSERT INTO webknossos.dataset_layer_attachments(_dataset, layerName, name, path, type, dataFormat, credentialId, uploadToPathIsPending, uploadIsPending)
                VALUES ($1, $2, $3, $4, $5::webknossos.LAYER_ATTACHMENT_TYPE, $6::webknossos.LAYER_ATTACHMENT_DATAFORMAT, $7, false, false)"#)
                .bind(dataset_id).bind(&layer.name).bind(&attachment.name).bind(&attachment.path)
                .bind(typ).bind(&attachment.data_format).bind(&attachment.credential_id)
                .execute(&mut *connection).await?;
        }
    }
    sqlx::query("DELETE FROM webknossos.dataset_layer_additionalAxes WHERE _dataset = $1")
        .bind(dataset_id)
        .execute(&mut *connection)
        .await?;
    for layer in layers {
        for axis in layer.additional_axes.iter().flatten() {
            sqlx::query("INSERT INTO webknossos.dataset_layer_additionalAxes(_dataset, layerName, name, lowerBound, upperBound, index) VALUES ($1, $2, $3, $4, $5, $6)")
                .bind(dataset_id).bind(&layer.name).bind(&axis.name)
                .bind(axis.bounds[0]).bind(axis.bounds[1]).bind(axis.index)
                .execute(&mut *connection).await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upaths_normalize_like_scala() {
        for (input, expected) in [
            ("/a/./b/../c/", "/a/c"),
            ("color/1", "./color/1"),
            ("./color//1", "./color/1"),
            ("../x", "./../x"),
            ("", "./"),
            ("file:///srv/a/../b", "/srv/b"),
            ("s3://bucket/a/./b/../c", "s3://bucket/a/c"),
            ("https://host:9000/..", "https://host:9000"),
            ("s3://bucket//double/", "s3://bucket//double/"),
            ("/data/x.zip|zip:/inner/p", "/data/x.zip|zip:inner/p"),
            ("s3://b/x.zip|zip", "s3://b/x.zip|zip"),
        ] {
            assert_eq!(normalize_upath(input).unwrap(), expected, "{input}");
        }
        assert!(normalize_upath("file://relative").is_err());
        assert!(normalize_upath("a.zip|zip:x|zip").is_err());
        assert!(upath_is_local("./a") && upath_is_local("file:///a"));
        assert!(!upath_is_local("s3://b/a.zip|zip:x"));
        assert_eq!(
            upath_join("./binaryData", "org").unwrap(),
            "./binaryData/org"
        );
        assert_eq!(upath_join("/srv/a", "../b").unwrap(), "/srv/b");
        assert_eq!(
            upath_join("s3://bucket/x/", "y/1").unwrap(),
            "s3://bucket/x/y/1"
        );
        assert_eq!(upath_join("/a.zip|zip", "c").unwrap(), "/a.zip|zip:c");
    }

    #[test]
    fn data_sources_parse_scala_variants_and_render() {
        let source = parse_data_source(&json!({
            "id": {"name": "ds", "team": "org"},
            "scale": [1, 2, 3.5],
            "dataLayers": [{
                "category": "segmentation", "name": "seg", "dataFormat": "zarr3", "elementClass": "uint32",
                "boundingBox": {"topLeft": [0, 0, 0], "width": 5, "height": 6, "depth": 7},
                "wkwResolutions": [{"resolution": 1, "cubeLength": 1024}, {"resolution": [2, 2, 1], "path": "s3://b/x"}],
                "largestSegmentId": {"customJsonEncoding": "bigint", "value": "18446744073709551615"},
                "mappings": ["b", "a", "b"],
                "defaultViewConfiguration": {},
                "attachments": {"meshes": [{"name": "m", "path": "meshes/m.hdf5", "dataFormat": "hdf5"}]}
            }]
        }))
        .unwrap();
        let layer = &source.layers[0];
        assert_eq!(source.unit, "nanometer");
        assert_eq!(layer.mags[0].mag, [1, 1, 1]);
        assert_eq!(layer.largest_segment_id, Some(-1));
        assert_eq!(
            layer.mappings.as_deref(),
            Some(&["a".to_owned(), "b".to_owned()][..])
        );
        assert_eq!(layer.default_view_configuration, None);
        assert_eq!(
            layer.attachments.as_ref().unwrap().meshes[0].path,
            "./meshes/m.hdf5"
        );
        let rendered = data_source_json(&source);
        assert_eq!(
            rendered["dataLayers"][0]["largestSegmentId"]["value"],
            "18446744073709551615"
        );
        assert_eq!(
            rendered["dataLayers"][0]["resolutions"],
            json!([[1, 1, 1], [2, 2, 1]])
        );
        assert_eq!(parse_data_source(&rendered).unwrap(), source);
        assert!(parse_data_source(&json!({"id": {"name": "x", "team": "y"}, "scale": [1, 1, 1], "dataLayers": [{"category": "mask"}]})).is_err());
    }
}
