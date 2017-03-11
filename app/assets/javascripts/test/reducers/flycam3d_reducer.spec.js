import * as Flycam3DActions from "oxalis/model/actions/flycam3d_actions";
import Flycam3DReducer from "oxalis/model/reducers/flycam3d_reducer";
import { M4x4, V3 } from "libs/mjs";
import { addTimestamp } from "oxalis/model/helpers/timestamp_middleware";
import { getPosition, getRotation, getUp, getLeft, getZoomedMatrix } from "oxalis/model/reducers/flycam3d_reducer_helper";

describe("Flycam3D", () => {
  const initialState = {
    dataset: {
      scale: [1, 1, 2],
    },
    userConfiguration: {
      sphericalCapRadius: 100,
    },
    flycam3d: {
      zoomStep: 2,
      currentMatrix: M4x4.identity,
    },
  };

  it("should calculate zoomed matrix", () => {
    expect(Array.from(getZoomedMatrix(initialState.flycam3d))).toEqual([
      2, 0, 0, 0,
      0, 2, 0, 0,
      0, 0, 2, 0,
      0, 0, 0, 1,
    ]);
  });

  it("should move the flycam", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([1, 2, 3]));
    const newState = Flycam3DReducer(initialState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([1, 2, 3]);
  });

  it("should move the flycam backwards", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([-1, -2, -3]));
    const newState = Flycam3DReducer(initialState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([-1, -2, -3]);
  });

  it("should move the flycam and move it again", () => {
    const moveAction = addTimestamp(Flycam3DActions.moveFlycamAction([1, 2, 3]));
    let newState = Flycam3DReducer(initialState, moveAction);
    newState = Flycam3DReducer(newState, moveAction);

    expect(getPosition(newState.flycam3d)).toEqual([2, 4, 6]);
  });

  it("should set the rotation the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.setRotationAction([180, 0, 0]));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getRotation(newState.flycam3d)).toEqual([180, 0, 0]);
    expect(V3.round(getUp(newState.flycam3d), [])).toEqual([0, 1, -0]);
    expect(V3.round(getLeft(newState.flycam3d), [])).toEqual([-1, 0, 0]);
  });

  it("should set the position the flycam", () => {
    const positionAction = addTimestamp(Flycam3DActions.setPositionAction([1, 2, 3]));
    const newState = Flycam3DReducer(initialState, positionAction);

    expect(getPosition(newState.flycam3d)).toEqual([1, 2, 3]);
  });

  it("should rotate the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.rotateFlycamAction(0.5 * Math.PI, [1, 1, 0]));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getPosition(newState.flycam3d)).toEqual([0, 0, 0]);
    expect(V3.floor(getRotation(newState.flycam3d))).toEqual([270, 315, 135]);
  });

  it("should pitch the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.pitchFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getPosition(newState.flycam3d)).toEqual([0, 0, 0]);
    expect(getRotation(newState.flycam3d)).toEqual([270, 0, 180]);
  });

  it("should pitch the flycam with spherical cap radius", () => {
    const rotateAction = addTimestamp(Flycam3DActions.pitchFlycamAction(0.5 * Math.PI, true));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getPosition(newState.flycam3d)).toEqual([0, -200, -200]);
    expect(getRotation(newState.flycam3d)).toEqual([270, 0, 180]);
  });

  it("should yaw the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.yawFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getRotation(newState.flycam3d)).toEqual([0, 270, 180]);
  });

  it("should roll the flycam", () => {
    const rotateAction = addTimestamp(Flycam3DActions.rollFlycamAction(0.5 * Math.PI));
    const newState = Flycam3DReducer(initialState, rotateAction);

    expect(getRotation(newState.flycam3d)).toEqual([0, 0, 90]);
  });
});
