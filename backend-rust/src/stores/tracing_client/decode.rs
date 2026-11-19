//! Protobuf decoding with the proto2 required-field checks performed by ScalaPB.

use prost::Message;

use crate::proto::{
    AnnotationLayerTypeProto, AnnotationProto,
    datastore::{SkeletonTracing, SkeletonTracings, VolumeTracing, VolumeTracings},
};

use super::TracingStoreError;

/// Decode an annotation including the nested proto2 required-field checks
/// performed by ScalaPB. Prost defaults missing scalar fields, so successful
/// decoding alone cannot distinguish an absent field from an explicit zero.
/// Layer types must also be supported by the application layer conversion.
pub fn decode_annotation_proto(bytes: &[u8]) -> Result<AnnotationProto, TracingStoreError> {
    let decoded = AnnotationProto::decode(bytes).map_err(|_| TracingStoreError::InvalidProtobuf)?;
    let invalid = || TracingStoreError::InvalidProtobuf;
    let top_level = field_tags(bytes).ok_or_else(invalid)?;
    if !has_required_fields(&top_level, &[1, 2, 4]) {
        return Err(invalid());
    }
    for (_, layer) in top_level.iter().filter(|(tag, _)| *tag == 3) {
        let layer_tags = field_tags(layer.ok_or_else(invalid)?).ok_or_else(invalid)?;
        if !has_required_fields(&layer_tags, &[1, 2, 3]) {
            return Err(invalid());
        }
    }
    for (_, state) in top_level.iter().filter(|(tag, _)| *tag == 7) {
        let state_fields = field_tags(state.ok_or_else(invalid)?).ok_or_else(invalid)?;
        if !has_required_fields(&state_fields, &[1, 2, 3, 4]) {
            return Err(invalid());
        }
        for (tag, payload) in &state_fields {
            let required: &[u32] = match tag {
                // Vec3IntProto editPosition and Vec3DoubleProto editRotation.
                2 | 3 => &[1, 2, 3],
                // AdditionalCoordinateProto (repeated).
                5 => &[1, 2],
                _ => continue,
            };
            let fields = field_tags(payload.ok_or_else(invalid)?).ok_or_else(invalid)?;
            if !has_required_fields(&fields, required) {
                return Err(invalid());
            }
        }
    }
    if decoded
        .annotation_layers
        .iter()
        .any(|layer| AnnotationLayerTypeProto::try_from(layer.typ).is_err())
    {
        return Err(invalid());
    }
    Ok(decoded)
}

/// Decode a SkeletonTracing, rejecting it like ScalaPB when any proto2
/// required field is missing in the message or any nested message occurrence
/// (same wire-level approach as `decode_annotation_proto`). Unrecognized enum
/// values are accepted, as ScalaPB keeps them as `Unrecognized`.
pub fn decode_skeleton_tracing(bytes: &[u8]) -> Result<SkeletonTracing, TracingStoreError> {
    decode_with_required(bytes, &required::SKELETON_TRACING)
}

/// Decode a VolumeTracing with the proto2 required-field checks of
/// `decode_skeleton_tracing`.
pub fn decode_volume_tracing(bytes: &[u8]) -> Result<VolumeTracing, TracingStoreError> {
    decode_with_required(bytes, &required::VOLUME_TRACING)
}

/// Decode a `SkeletonTracings` (getMultiple response), applying the
/// SkeletonTracing required-field checks to every present
/// `SkeletonTracingOpt.tracing`.
pub fn decode_skeleton_tracings(bytes: &[u8]) -> Result<SkeletonTracings, TracingStoreError> {
    decode_with_required(bytes, &required::SKELETON_TRACINGS)
}

/// Decode a `VolumeTracings` (getMultiple response), applying the
/// VolumeTracing required-field checks to every present `VolumeTracingOpt.tracing`.
pub fn decode_volume_tracings(bytes: &[u8]) -> Result<VolumeTracings, TracingStoreError> {
    decode_with_required(bytes, &required::VOLUME_TRACINGS)
}

fn decode_with_required<M: Message + Default>(
    bytes: &[u8],
    schema: &RequiredFields,
) -> Result<M, TracingStoreError> {
    // prost decoding first: it enforces wire types and its recursion limit,
    // which also bounds the recursion of `satisfies_required`.
    let decoded = M::decode(bytes).map_err(|_| TracingStoreError::InvalidProtobuf)?;
    if !satisfies_required(bytes, schema) {
        return Err(TracingStoreError::InvalidProtobuf);
    }
    Ok(decoded)
}

/// proto2 `required` field tags of a message and its message-typed fields
/// (singular and repeated alike: every occurrence is checked).
struct RequiredFields {
    required: &'static [u32],
    nested: &'static [(u32, &'static RequiredFields)],
}

fn satisfies_required(bytes: &[u8], schema: &RequiredFields) -> bool {
    let Some(fields) = field_tags(bytes) else {
        return false;
    };
    has_required_fields(&fields, schema.required)
        && fields.iter().all(|(tag, payload)| {
            match schema
                .nested
                .iter()
                .find(|(nested_tag, _)| nested_tag == tag)
            {
                Some((_, nested)) => {
                    payload.is_some_and(|payload| satisfies_required(payload, nested))
                }
                None => true,
            }
        })
}

/// Required-field tables transcribed from `webknossos-datastore/proto`
/// (geometry, MetadataEntry, IdWithBool, SkeletonTracing, VolumeTracing).
mod required {
    use super::RequiredFields;

    const fn leaf(required: &'static [u32]) -> RequiredFields {
        RequiredFields {
            required,
            nested: &[],
        }
    }

    static VEC3_INT: RequiredFields = leaf(&[1, 2, 3]);
    static VEC2_INT: RequiredFields = leaf(&[1, 2]);
    static VEC3_DOUBLE: RequiredFields = leaf(&[1, 2, 3]);
    static COLOR: RequiredFields = leaf(&[1, 2, 3, 4]);
    static BOUNDING_BOX: RequiredFields = RequiredFields {
        required: &[1, 2, 3, 4],
        nested: &[(1, &VEC3_INT)],
    };
    static NAMED_BOUNDING_BOX: RequiredFields = RequiredFields {
        required: &[1, 5],
        nested: &[(4, &COLOR), (5, &BOUNDING_BOX)],
    };
    static ADDITIONAL_COORDINATE: RequiredFields = leaf(&[1, 2]);
    static ADDITIONAL_AXIS: RequiredFields = RequiredFields {
        required: &[1, 2, 3],
        nested: &[(3, &VEC2_INT)],
    };
    static METADATA_ENTRY: RequiredFields = leaf(&[1]);
    static ID_WITH_BOOL: RequiredFields = leaf(&[1, 2]);

    static NODE: RequiredFields = RequiredFields {
        required: &[1, 2, 3, 4, 5, 6, 7, 8, 9],
        nested: &[
            (2, &VEC3_INT),
            (3, &VEC3_DOUBLE),
            (10, &ADDITIONAL_COORDINATE),
        ],
    };
    static EDGE: RequiredFields = leaf(&[1, 2]);
    static COMMENT: RequiredFields = leaf(&[1, 2]);
    static BRANCH_POINT: RequiredFields = leaf(&[1, 2]);
    static TREE_AGGLOMERATE_INFO: RequiredFields = leaf(&[1]);
    static TREE: RequiredFields = RequiredFields {
        required: &[1, 7, 8],
        nested: &[
            (2, &NODE),
            (3, &EDGE),
            (4, &COLOR),
            (5, &BRANCH_POINT),
            (6, &COMMENT),
            (13, &METADATA_ENTRY),
            (14, &TREE_AGGLOMERATE_INFO),
        ],
    };
    static TREE_GROUP: RequiredFields = RequiredFields {
        required: &[1, 2],
        nested: &[(3, &TREE_GROUP)],
    };
    static SKELETON_USER_STATE: RequiredFields = RequiredFields {
        required: &[1],
        nested: &[(3, &ID_WITH_BOOL), (4, &ID_WITH_BOOL), (5, &ID_WITH_BOOL)],
    };
    pub(super) static SKELETON_TRACING: RequiredFields = RequiredFields {
        required: &[1, 3, 6, 7, 8, 9],
        nested: &[
            (2, &TREE),
            (4, &BOUNDING_BOX),
            (6, &VEC3_INT),
            (7, &VEC3_DOUBLE),
            (10, &BOUNDING_BOX),
            (11, &TREE_GROUP),
            (12, &NAMED_BOUNDING_BOX),
            (21, &ADDITIONAL_COORDINATE),
            (22, &ADDITIONAL_AXIS),
            (24, &SKELETON_USER_STATE),
        ],
    };

    static SEGMENT: RequiredFields = RequiredFields {
        required: &[1],
        nested: &[
            (2, &VEC3_INT),
            (5, &COLOR),
            (7, &ADDITIONAL_COORDINATE),
            (11, &METADATA_ENTRY),
        ],
    };
    static SEGMENT_GROUP: RequiredFields = RequiredFields {
        required: &[1, 2],
        nested: &[(3, &SEGMENT_GROUP)],
    };
    static VOLUME_USER_STATE: RequiredFields = RequiredFields {
        required: &[1],
        // Id32WithBool (3, 4) and Id64WithBool (5) share their required tags.
        nested: &[(3, &ID_WITH_BOOL), (4, &ID_WITH_BOOL), (5, &ID_WITH_BOOL)],
    };
    pub(super) static VOLUME_TRACING: RequiredFields = RequiredFields {
        required: &[2, 3, 4, 5, 6, 7, 10, 11],
        nested: &[
            (2, &BOUNDING_BOX),
            (5, &VEC3_INT),
            (6, &VEC3_DOUBLE),
            (12, &BOUNDING_BOX),
            (13, &NAMED_BOUNDING_BOX),
            (15, &VEC3_INT),
            (16, &SEGMENT),
            (19, &SEGMENT_GROUP),
            (21, &ADDITIONAL_COORDINATE),
            (22, &ADDITIONAL_AXIS),
            (26, &VOLUME_USER_STATE),
        ],
    };

    // SkeletonTracingOpt / VolumeTracingOpt: `optional <Tracing> tracing = 1`.
    static SKELETON_TRACING_OPT: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &SKELETON_TRACING)],
    };
    static VOLUME_TRACING_OPT: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &VOLUME_TRACING)],
    };
    // SkeletonTracings / VolumeTracings: `repeated <Tracing>Opt tracings = 1`.
    pub(super) static SKELETON_TRACINGS: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &SKELETON_TRACING_OPT)],
    };
    pub(super) static VOLUME_TRACINGS: RequiredFields = RequiredFields {
        required: &[],
        nested: &[(1, &VOLUME_TRACING_OPT)],
    };
}

/// A field tag with its length-delimited payload, if any.
type WireField<'a> = (u32, Option<&'a [u8]>);

fn has_required_fields(fields: &[WireField<'_>], required: &[u32]) -> bool {
    required
        .iter()
        .all(|required| fields.iter().any(|(tag, _)| tag == required))
}

/// Top-level field tags; length-delimited payloads are returned for nesting.
fn field_tags(mut bytes: &[u8]) -> Option<Vec<WireField<'_>>> {
    use prost::encoding::{WireType, decode_key, decode_varint};
    let mut tags = Vec::new();
    while !bytes.is_empty() {
        let (tag, wire_type) = decode_key(&mut bytes).ok()?;
        let payload = match wire_type {
            WireType::Varint => {
                decode_varint(&mut bytes).ok()?;
                None
            }
            WireType::SixtyFourBit => {
                bytes = bytes.get(8..)?;
                None
            }
            WireType::ThirtyTwoBit => {
                bytes = bytes.get(4..)?;
                None
            }
            WireType::LengthDelimited => {
                let length = usize::try_from(decode_varint(&mut bytes).ok()?).ok()?;
                let payload = bytes.get(..length)?;
                bytes = &bytes[length..];
                Some(payload)
            }
            // ScalaPB's UnknownFieldSet rejects groups, including well-formed
            // unknown groups. Keep the same behavior (see the Scala fixture corpus).
            WireType::StartGroup | WireType::EndGroup => return None,
        };
        tags.push((tag, payload));
    }
    Some(tags)
}
