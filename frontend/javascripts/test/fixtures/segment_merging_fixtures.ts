import { updateSegmentAction } from "viewer/model/actions/volumetracing_actions";
import type { Segment, WebknossosState } from "viewer/store";
import { VOLUME_TRACING_ID } from "./volumetracing_server_objects";

export const getSegment = (state: WebknossosState, id: number) =>
  state.annotation.volumes[0].segments.getNullable(id);
export const createAction = (id: number, properties: Partial<Segment>) =>
  updateSegmentAction(
    id,
    {
      anchorPosition: [id, id, id],
      groupId: id,
      ...properties,
    },
    VOLUME_TRACING_ID,
    undefined,
    true,
  );

const [id1, id2, id3] = [1, 2, 3];
export { id1, id2, id3 };
export const createSegment1 = createAction(id1, {
  name: "Name 1",
  metadata: [
    { key: "someKey1", stringValue: "someStringValue - segment 1" },
    { key: "someKey2", stringListValue: ["list", "value", "segment 1"] },
    { key: "identicalKey", stringValue: "identicalValue" },
  ],
});
export const createSegment2 = createAction(id2, {
  name: "Name 2",
  metadata: [
    { key: "someKey1", stringValue: "someStringValue - segment 2" },
    { key: "someKey3", stringListValue: ["list", "value", "segment 2"] },
    { key: "identicalKey", stringValue: "identicalValue" },
  ],
});
export const createSegment3 = createAction(id3, {
  name: "Name 3",
  metadata: [],
});

export const createSegment1WithoutOptionalProps = createAction(id1, {
  anchorPosition: null,
  groupId: null,
  metadata: [],
});
export const createSegment2WithAdditionalProps = createAction(id2, {
  name: "Name 2",
  metadata: [{ key: "someKey1", stringValue: "someStringValue - segment 2" }],
  additionalCoordinates: [{ name: "t", value: 3 }],
});
