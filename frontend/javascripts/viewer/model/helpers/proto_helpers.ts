// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'AnnotationProto.proto' or its co... Remove this comment to see the full error message
import AnnotationProto from "Annotation.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'ListOfLong.proto' or its co... Remove this comment to see the full error message
import ListOfLongProto from "ListOfLong.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'SkeletonTracing.proto' or its ... Remove this comment to see the full error message
import SkeletonTracingProto from "SkeletonTracing.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'VolumeTracing.proto' or its co... Remove this comment to see the full error message
import VolumeTracingProto from "VolumeTracing.proto";
import { toBigInt } from "libs/bigint_helpers";
import { Root, util } from "protobufjs/light";
import type { APITracingStoreAnnotation, ServerTracing } from "types/api_types";

export const PROTO_FILES = {
  skeleton: SkeletonTracingProto,
  volume: VolumeTracingProto,
};
const PROTO_PACKAGE = "com.scalableminds.webknossos.datastore";
export const PROTO_TYPES = {
  skeleton: `${PROTO_PACKAGE}.SkeletonTracing`,
  volume: `${PROTO_PACKAGE}.VolumeTracing`,
};

export function parseProtoTracing(
  tracingArrayBuffer: ArrayBuffer,
  annotationType: "skeleton" | "volume",
): ServerTracing {
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);
  const message = messageType.decode(new Uint8Array(tracingArrayBuffer));

  // longs: String is needed so that uint64 segment/agglomerate ids (which can exceed the
  // JS Number safe-integer range) don't lose precision during decoding. This affects every
  // int64/uint64 field in the message, not just ids, so non-id 64-bit fields (timestamps)
  // are converted back to `number` below (they safely fit, unlike ids).
  const tracing = messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: String,
  }) as any;

  tracing.createdTimestamp = Number(tracing.createdTimestamp);

  if (annotationType === "volume") {
    if (tracing.activeSegmentId != null)
      tracing.activeSegmentId = toBigInt(tracing.activeSegmentId);
    if (tracing.largestSegmentId != null)
      tracing.largestSegmentId = toBigInt(tracing.largestSegmentId);
    for (const segment of tracing.segments ?? []) {
      segment.segmentId = toBigInt(segment.segmentId);
      if (segment.creationTime != null) segment.creationTime = Number(segment.creationTime);
    }
    for (const userState of tracing.userStates ?? []) {
      if (userState.activeSegmentId != null) {
        userState.activeSegmentId = toBigInt(userState.activeSegmentId);
      }
      for (const entry of userState.segmentVisibilities ?? []) {
        entry.id = toBigInt(entry.id);
      }
    }
  } else {
    for (const tree of tracing.trees ?? []) {
      tree.createdTimestamp = Number(tree.createdTimestamp);
      if (tree.agglomerateInfo != null) {
        tree.agglomerateInfo.agglomerateId = toBigInt(tree.agglomerateInfo.agglomerateId);
      }
      for (const node of tree.nodes ?? []) {
        node.createdTimestamp = Number(node.createdTimestamp);
      }
      for (const branchPoint of tree.branchPoints ?? []) {
        branchPoint.createdTimestamp = Number(branchPoint.createdTimestamp);
      }
    }
  }

  delete tracing.version;

  return tracing as ServerTracing;
}

// protobufjs' verify()/create() don't accept plain decimal strings (or native bigints) for
// uint64 fields beyond the safe integer range -- they require a Long-like object instead.
// protobufjs' type declarations don't expose the (runtime-available) static methods of
// util.Long, hence the cast.
const ProtoLong = util.Long as unknown as {
  fromString: (value: string, unsigned: boolean) => unknown;
};
export function bigIntToProtoLong(value: bigint): unknown {
  return ProtoLong.fromString(value.toString(), true);
}

export function serializeProtoListOfLong(bigInts: Array<bigint>): Uint8Array<ArrayBuffer> {
  const listOfLong = { items: bigInts.map(bigIntToProtoLong) };
  const protoRoot = Root.fromJSON(ListOfLongProto);
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  const errMsg = messageType.verify(listOfLong);

  if (errMsg) throw Error(errMsg);
  const message = messageType.create(listOfLong);

  return messageType.encode(message).finish() as Uint8Array<ArrayBuffer>;
}

export function parseProtoListOfLong(listArrayBuffer: ArrayBuffer): Array<bigint> {
  const protoRoot = Root.fromJSON(ListOfLongProto);
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  const message = messageType.decode(new Uint8Array(listArrayBuffer));

  const { items } = messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: String,
  }) as { items: string[] };

  return items.map(toBigInt);
}

export function parseProtoAnnotation(annotationArrayBuffer: ArrayBuffer): any {
  const protoRoot = Root.fromJSON(AnnotationProto);
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.AnnotationProto`);
  const message = messageType.decode(new Uint8Array(annotationArrayBuffer));

  return messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: Number,
  }) as APITracingStoreAnnotation;
}
