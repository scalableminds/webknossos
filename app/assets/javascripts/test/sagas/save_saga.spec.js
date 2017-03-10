import { compactUpdateActions } from "oxalis/model/sagas/save_saga";
import * as UpdateActions from "oxalis/model/sagas/update_actions";

describe("SaveSaga", () => {
  const initialState = {
    task: {
      id: 1,
    },
    skeletonTracing: {
      trees: {
        "0": {
          treeId: 0,
          name: "TestTree",
          nodes: {},
          timestamp: 12345678,
          branchPoints: [],
          edges: [],
          comments: [],
          color: [23, 23, 23],
        },
      },
      tracingType: "Explorational",
      name: "",
      activeTreeId: 0,
      activeNodeId: null,
      restrictions: {
        branchPointsAllowed: true,
        allowUpdate: true,
        allowFinish: true,
        allowAccess: true,
        allowDownload: true,
      },
    },
  };

  it("should compact multiple updateTracing update actions", () => {
    const updateActions = [
      UpdateActions.updateTracing(initialState, [1, 2, 3], [0, 0, 1], 1),
      UpdateActions.updateTracing(initialState, [2, 3, 4], [0, 0, 1], 2),
    ];

    expect(compactUpdateActions(updateActions)).toEqual([updateActions[1]]);
  });
});
