import update from "immutability-helper";
import { initialState as skeletonInitialState } from "test/fixtures/skeletontracing_object";
import { getLayerBoundingBoxId } from "viewer/model/accessors/dataset_accessor";
import { setMipForBBoxAction } from "viewer/model/actions/annotation_actions";
import MipBBoxReducer from "viewer/model/reducers/mip_bbox_reducer";
import type { UserBoundingBox, WebknossosState } from "viewer/store";
import { describe, expect, it } from "vitest";

// The fixture's dataset has a single (color) layer, so its layer bounding box gets the first
// synthetic id.
const LAYER_BBOX_ID = getLayerBoundingBoxId(0);
const LAYER_NAME = "color";

const userBoundingBox: UserBoundingBox = {
  id: 1,
  name: "user bbox",
  boundingBox: { min: [0, 0, 0], max: [16, 16, 16] },
  color: [1, 0, 0],
  isVisible: false,
};

const stateWithHiddenUserBBox: WebknossosState = update(skeletonInitialState, {
  annotation: { skeleton: { userBoundingBoxes: { $set: [userBoundingBox] } } },
});

describe("MipBBoxReducer", () => {
  it("should make a user bounding box visible when a MIP layer is enabled for it", () => {
    expect(stateWithHiddenUserBBox.annotation.skeleton?.userBoundingBoxes[0].isVisible).toBe(false);

    const newState = MipBBoxReducer(
      stateWithHiddenUserBBox,
      setMipForBBoxAction(userBoundingBox.id, {
        layerName: LAYER_NAME,
        zoomStep: 0,
        isLoading: false,
      }),
    );

    expect(newState.annotation.skeleton?.userBoundingBoxes[0].isVisible).toBe(true);
  });

  it("should make a layer bounding box's outline visible when a MIP layer is enabled for it", () => {
    // Regression test for #9802 follow-up: enabling MIP for a layer bounding box used to leave its
    // outline switch (and therefore the MIP volume, which used to be gated on it) hidden.
    expect(
      skeletonInitialState.temporaryConfiguration.layerBoundingBoxVisibilities[LAYER_NAME],
    ).toBe(undefined);

    const newState = MipBBoxReducer(
      skeletonInitialState,
      setMipForBBoxAction(LAYER_BBOX_ID, { layerName: LAYER_NAME, zoomStep: 0, isLoading: false }),
    );

    expect(newState.temporaryConfiguration.layerBoundingBoxVisibilities[LAYER_NAME]).toBe(true);
  });

  it("should not touch a user bounding box's visibility for other reducer actions", () => {
    const newState = MipBBoxReducer(stateWithHiddenUserBBox, {
      type: "REMOVE_MIP_FOR_BBOX",
      id: userBoundingBox.id,
    });

    expect(newState.annotation.skeleton?.userBoundingBoxes[0].isVisible).toBe(false);
  });
});
