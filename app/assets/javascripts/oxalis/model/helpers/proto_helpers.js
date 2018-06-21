// @flow

import { Root } from "protobufjs/light";
import type { ServerTracingType } from "admin/api_flow_types";
// The babel-plugin-file-loader gets confused with the absolute paths, which is why they have to be relative
// We need this plugin to work to ignore the .proto files in the tests
import SkeletonTracingProto from "../../../../../../webknossos-datastore/proto/SkeletonTracing.proto";
import VolumeTracingProto from "../../../../../../webknossos-datastore/proto/VolumeTracing.proto";

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
): ServerTracingType {
  const protoRoot = Root.fromJSON(PROTO_FILES[annotationType]);
  const messageType = protoRoot.lookupType(PROTO_TYPES[annotationType]);
  const message = messageType.decode(new Uint8Array(tracingArrayBuffer));
  return messageType.toObject(message, { arrays: true, objects: true, enums: String });
}

export default {};
