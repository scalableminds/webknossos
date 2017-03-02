import { call, takeEvery, select } from "redux-saga/effects";
import Request from "libs/request";

function* centerActiveNode() {
  const { activeNodeId, activeTreeId, trees } = yield select(state => state.skeletonTracing);
  const position = trees[activeTreeId].nodes[activeNodeId].position;

  // Should be an action in the future
  window.webknossos.model.flycam.setPosition(position);
}

function* pushAnnotation(action, payload) {
  const APICall = Request.sendJSONReceiveJSON(
    `/annotations/${this.tracingType}/${this.tracingId}?version=${(version + 1)}`, {
      method: "PUT",
      data: [{
        action,
        value: payload,
      }],
    },
  );

  yield call(APICall);
}

export function* watchSkeletonTracingAsync() {
  yield takeEvery(["CREATE_NODE", "SET_ACTIVE_TREE", "SET_ACTIVE_NODE", "DELETE_NODE"], centerActiveNode);
}

