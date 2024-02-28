import { Root } from "protobufjs/light";
import type { ServerTracing } from "types/api_flow_types";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'SkeletonTracing.proto' or its ... Remove this comment to see the full error message
import SkeletonTracingProto from "SkeletonTracing.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'VolumeTracing.proto' or its co... Remove this comment to see the full error message
import VolumeTracingProto from "VolumeTracing.proto";
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'ListOfLong.proto' or its co... Remove this comment to see the full error message
import ListOfLongProto from "ListOfLong.proto";

const PROTO_FILES = {
  skeleton: SkeletonTracingProto,
  volume: VolumeTracingProto,
};
const PROTO_PACKAGE = "com.scalableminds.webknossos.datastore";
const PROTO_TYPES = {
  skeleton: `${PROTO_PACKAGE}.SkeletonTracing`,
  volume: `${PROTO_PACKAGE}.VolumeTracing`,
};

export function parseProtoTracing(
  tracingArrayBuffer: ArrayBuffer,
  annotationType: string,
): ServerTracing {
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);
  const message = messageType.decode(new Uint8Array(tracingArrayBuffer));
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ [k: string]: any; }' is not assignable to ... Remove this comment to see the full error message
  return messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: Number,
  });
}

export function serializeProtoListOfLong(numbers: number[]): ArrayBuffer {
  const protoRoot = Root.fromJSON(ListOfLongProto);
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ [k: string]: any; }' is not assignable to ... Remove this comment to see the full error message
  var errMsg = messageType.verify(numbers);
  if (errMsg) throw Error(errMsg);
  const message = messageType.create(numbers);
  return messageType.encode(message).finish();
}

export function parseProtoListOfLong(listArrayBuffer: ArrayBuffer): number[] {
  const protoRoot = Root.fromJSON(ListOfLongProto);
  // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
  const messageType = protoRoot.lookupType(`${PROTO_PACKAGE}.ListOfLong`);
  const message = messageType.decode(new Uint8Array(listArrayBuffer));
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ [k: string]: any; }' is not assignable to ... Remove this comment to see the full error message
  return messageType.toObject(message, {
    arrays: true,
    objects: true,
    enums: String,
    longs: Number,
  });
}
export default {};
