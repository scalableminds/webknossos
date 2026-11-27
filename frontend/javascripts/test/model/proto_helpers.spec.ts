import { Root } from "protobufjs/light";
import type { ServerSkeletonTracing } from "types/api_types";
import {
  bigIntToProtoLong,
  PROTO_FILES,
  PROTO_TYPES,
  parseProtoTracing,
} from "viewer/model/helpers/proto_helpers";
import { describe, expect, it } from "vitest";

function encodeSkeletonTracing(tracing: Record<string, unknown>): ArrayBuffer {
  const messageType = Root.fromJSON(PROTO_FILES.skeleton).lookupType(PROTO_TYPES.skeleton);
  const encoded = messageType.encode(messageType.fromObject(tracing)).finish();
  return new Uint8Array(encoded).buffer;
}

function makeTracingWithAgglomerateInfo(agglomerateInfo: Record<string, unknown>) {
  return {
    datasetName: "dataset",
    createdTimestamp: 0,
    editPosition: { x: 0, y: 0, z: 0 },
    editRotation: { x: 0, y: 0, z: 0 },
    zoomLevel: 1,
    version: 0,
    trees: [
      {
        treeId: 1,
        name: "tree",
        createdTimestamp: 0,
        agglomerateInfo: { agglomerateId: bigIntToProtoLong(2n ** 60n), ...agglomerateInfo },
      },
    ],
  };
}

describe("parseProtoTracing", () => {
  it("parses the layer and clicked position of an agglomerate skeleton", () => {
    const buffer = encodeSkeletonTracing(
      makeTracingWithAgglomerateInfo({
        mappingName: "agglomerate_view_5",
        layerName: "segmentation",
        clickedPosition: { x: 1, y: 2, z: 3 },
      }),
    );

    const tracing = parseProtoTracing(buffer, "skeleton") as ServerSkeletonTracing;

    expect(tracing.trees[0].agglomerateInfo).toEqual({
      agglomerateId: 2n ** 60n,
      mappingName: "agglomerate_view_5",
      layerName: "segmentation",
      clickedPosition: [1, 2, 3],
    });
  });

  it("leaves out the clicked position if it is not stored", () => {
    const buffer = encodeSkeletonTracing(makeTracingWithAgglomerateInfo({ tracingId: "tracing" }));

    const tracing = parseProtoTracing(buffer, "skeleton") as ServerSkeletonTracing;

    expect(tracing.trees[0].agglomerateInfo).toEqual({
      agglomerateId: 2n ** 60n,
      tracingId: "tracing",
    });
  });
});
