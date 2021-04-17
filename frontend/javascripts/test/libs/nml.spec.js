// @flow

import _ from "lodash";
import update from "immutability-helper";
import sinon from "sinon";

import { type Node } from "oxalis/store";
import defaultState from "oxalis/default_state";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import { findGroup } from "oxalis/view/right-border-tabs/tree_hierarchy_view_helpers";
import mock from "mock-require";
import test from "ava";

const TIMESTAMP = 123456789;
const buildInfo = {
  webknossos: {
    commitHash: "fc0ea6432ec7107e8f9b5b308ee0e90eae0e7b17",
  },
};
const { serializeToNml, getNmlName, parseNml } = mock.reRequire("oxalis/model/helpers/nml_helpers");
const SkeletonTracingReducer = mock.reRequire("oxalis/model/reducers/skeletontracing_reducer")
  .default;
const SkeletonTracingActions = mock.reRequire("oxalis/model/actions/skeletontracing_actions");

const createDummyNode = (id: number): Node => ({
  bitDepth: 8,
  id,
  position: [id, id, id],
  radius: id,
  resolution: 10,
  rotation: [id, id, id],
  timestamp: id,
  viewport: 1,
  interpolation: id % 2 === 0,
});

const tracing = {
  annotationId: "annotationId",
  name: "",
  restrictions: {
    branchPointsAllowed: true,
    allowUpdate: true,
    allowFinish: true,
    allowAccess: true,
    allowDownload: true,
  },
  skeleton: {
    type: "skeleton",
    cachedMaxNodeId: 7,
    trees: {
      "1": {
        treeId: 1,
        name: "TestTree-0",
        nodes: new DiffableMap([
          [0, createDummyNode(0)],
          [1, createDummyNode(1)],
          [2, createDummyNode(2)],
          [7, createDummyNode(7)],
        ]),
        timestamp: 0,
        branchPoints: [{ nodeId: 1, timestamp: 0 }, { nodeId: 7, timestamp: 0 }],
        edges: EdgeCollection.loadFromArray([
          { source: 0, target: 1 },
          { source: 2, target: 1 },
          { source: 1, target: 7 },
        ]),
        comments: [{ content: "comment", nodeId: 0 }],
        color: [0.09019607843137255, 0.09019607843137255, 0.09019607843137255],
        isVisible: true,
        groupId: 3,
      },
      "2": {
        treeId: 2,
        name: "TestTree-1",
        nodes: new DiffableMap([
          [4, createDummyNode(4)],
          [5, createDummyNode(5)],
          [6, createDummyNode(6)],
        ]),
        timestamp: 4,
        branchPoints: [],
        edges: EdgeCollection.loadFromArray([{ source: 4, target: 5 }, { source: 5, target: 6 }]),
        comments: [],
        color: [0.11764705882352941, 0.11764705882352941, 0.11764705882352941],
        isVisible: true,
        groupId: 2,
      },
    },
    annotationType: "Explorational",
    treeGroups: [
      {
        groupId: 1,
        name: "Axon 1",
        children: [
          {
            groupId: 3,
            name: "Blah",
            children: [],
          },
        ],
      },
      {
        groupId: 2,
        name: "Axon 2",
        children: [],
      },
    ],
    activeTreeId: 1,
    activeNodeId: 1,
    boundingBox: {
      min: [0, 0, 0],
      max: [500, 500, 500],
    },
    userBoundingBoxes: [
      {
        id: 10,
        boundingBox: { min: [5, 5, 5], max: [250, 250, 250] },
        name: "Test Bounding Box",
        color: [1, 0, 0],
        isVisible: true,
      },
    ],
  },
};

const initialState = _.extend({}, defaultState, {
  tracing,
  activeUser: { firstName: "SCM", lastName: "Boy" },
  task: {
    id: 1,
  },
});

async function testThatParserThrowsWithState(t, invalidState, key) {
  // Serialize the NML using the invalidState, then parse it again, which should throw an NMLParseError
  const nmlWithInvalidContent = serializeToNml(
    invalidState,
    invalidState.tracing,
    invalidState.tracing.skeleton,
    buildInfo,
  );
  await throwsAsyncParseError(t, () => parseNml(nmlWithInvalidContent), key);
}

async function throwsAsyncParseError(t, fn, key) {
  try {
    await fn.call();
    t.fail(`Test did not throw, calling the function with the following key: ${key}`);
  } catch (e) {
    if (e.name === "NmlParseError") {
      t.true(true);
    } else {
      throw e;
    }
  }
}

test.before("Mock Date.now", async () => {
  // This only mocks Date.now, but leaves the constructor intact
  sinon.stub(Date, "now").returns(TIMESTAMP);
});

test.after("Reset mocks", async () => {
  Date.now.restore();
});

test("NML serializing and parsing should yield the same state", async t => {
  const serializedNml = serializeToNml(
    initialState,
    initialState.tracing,
    initialState.tracing.skeleton,
    buildInfo,
  );
  const { trees, treeGroups } = await parseNml(serializedNml);

  t.deepEqual(initialState.tracing.skeleton.trees, trees);
  t.deepEqual(initialState.tracing.skeleton.treeGroups, treeGroups);
});

test("NML serializing and parsing should yield the same state even when using special characters", async t => {
  const state = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "1": { comments: { $push: [{ nodeId: 1, content: "Hello\"a'b<c>d&e\"f'g<h>i&j" }] } },
        },
      },
    },
  });
  const serializedNml = serializeToNml(state, state.tracing, state.tracing.skeleton, buildInfo);
  const { trees, treeGroups } = await parseNml(serializedNml);

  t.deepEqual(state.tracing.skeleton.trees, trees);
  t.deepEqual(state.tracing.skeleton.treeGroups, treeGroups);
});

test("NML serializing and parsing should yield the same state even when using multiline attributes", async t => {
  const state = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "1": { comments: { $push: [{ nodeId: 1, content: "Hello\nfrom\nthe\nother\nside." }] } },
        },
      },
    },
  });
  const serializedNml = serializeToNml(state, state.tracing, state.tracing.skeleton, buildInfo);
  const { trees, treeGroups } = await parseNml(serializedNml);

  t.deepEqual(state.tracing.skeleton.trees, trees);
  t.deepEqual(state.tracing.skeleton.treeGroups, treeGroups);
});

test("NML Serializer should only serialize visible trees", async t => {
  const state = update(initialState, {
    tracing: {
      skeleton: { trees: { "1": { isVisible: { $set: false } } } },
    },
  });
  const serializedNml = serializeToNml(state, state.tracing, state.tracing.skeleton, buildInfo);
  const { trees } = await parseNml(serializedNml);

  // Tree 1 should not be exported as it is not visible
  delete state.tracing.skeleton.trees["1"];
  t.deepEqual(Object.keys(state.tracing.skeleton.trees), Object.keys(trees));
  t.deepEqual(state.tracing.skeleton.trees, trees);
});

test("NML Serializer should only serialize groups with visible trees", async t => {
  const state = update(initialState, {
    tracing: {
      skeleton: { trees: { "1": { isVisible: { $set: false } } } },
    },
  });
  const serializedNml = serializeToNml(state, state.tracing, state.tracing.skeleton, buildInfo);
  const { treeGroups } = await parseNml(serializedNml);

  // Group 1 (and group 3 and 4 which are children of group 1) should not be exported as they do not contain a visible tree
  const expectedTreeGroups = state.tracing.skeleton.treeGroups.filter(group => group.groupId !== 1);
  t.deepEqual(expectedTreeGroups, treeGroups);
});

test("NML serializer should produce correct NMLs", t => {
  const serializedNml = serializeToNml(
    initialState,
    initialState.tracing,
    initialState.tracing.skeleton,
    buildInfo,
  );

  t.snapshot(serializedNml, { id: "nml" });
});

test("NML serializer should escape special characters and multilines", t => {
  const state = update(initialState, {
    tracing: {
      description: { $set: "Multiline dataset\ndescription\nwith special &'<>\" chars." },
      skeleton: {
        trees: {
          "1": {
            comments: {
              $push: [{ nodeId: 1, content: "Hello\"a'b<c>d&e\"f'g<h>i&j\nwith\nnew\nlines" }],
            },
          },
        },
      },
    },
  });

  const serializedNml = serializeToNml(state, state.tracing, state.tracing.skeleton, buildInfo);

  // Explicitly check for the encoded characters
  t.true(
    serializedNml.indexOf(
      "Hello&quot;a&apos;b&lt;c&gt;d&amp;e&quot;f&apos;g&lt;h&gt;i&amp;j&#xa;with&#xa;new&#xa;lines",
    ) > -1,
  );

  t.snapshot(serializedNml, { id: "nml-special-chars" });
});

test("Serialized nml should be correctly named", async t => {
  t.is(getNmlName(initialState), "Test Dataset__1__sboy__tionId.nml");
  const stateWithoutTask = _.omit(initialState, "task");
  t.is(getNmlName(stateWithoutTask), "Test Dataset__explorational__sboy__tionId.nml");
});

test("NML Parser should throw errors for invalid nmls", async t => {
  const invalidCommentState = update(initialState, {
    tracing: {
      skeleton: { trees: { "2": { comments: { $set: [{ content: "test", nodeId: 99 }] } } } },
    },
  });
  const invalidBranchPointState = update(initialState, {
    tracing: {
      skeleton: { trees: { "2": { branchPoints: { $set: [{ timestamp: 0, nodeId: 99 }] } } } },
    },
  });
  const invalidEdgeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "2": { edges: { $set: EdgeCollection.loadFromArray([{ source: 99, target: 5 }]) } },
        },
      },
    },
  });
  const invalidSelfEdgeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "2": {
            edges: {
              $set: EdgeCollection.loadFromArray([
                { source: 4, target: 5 },
                { source: 5, target: 6 },
                { source: 6, target: 6 },
              ]),
            },
          },
        },
      },
    },
  });
  const duplicateEdgeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "2": {
            edges: {
              $set: EdgeCollection.loadFromArray([
                { source: 4, target: 5 },
                { source: 4, target: 5 },
                { source: 5, target: 6 },
              ]),
            },
          },
        },
      },
    },
  });
  const duplicateNodeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "1": {
            nodes: {
              $set: new DiffableMap([
                [0, createDummyNode(0)],
                [1, createDummyNode(1)],
                [2, createDummyNode(2)],
                [4, createDummyNode(4)],
                [7, createDummyNode(7)],
              ]),
            },
          },
          "2": {
            nodes: {
              $set: new DiffableMap([
                [4, createDummyNode(4)],
                [5, createDummyNode(5)],
                [6, createDummyNode(6)],
              ]),
            },
          },
        },
      },
    },
  });
  const duplicateTreeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "2": {
            treeId: {
              $set: 1,
            },
          },
        },
      },
    },
  });
  const missingGroupIdState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "2": {
            groupId: { $set: 9999 },
          },
        },
      },
    },
  });
  const duplicateGroupIdState = update(initialState, {
    tracing: {
      skeleton: {
        treeGroups: {
          $push: [
            {
              groupId: 3,
              name: "Group",
              children: [],
            },
          ],
        },
      },
    },
  });

  await testThatParserThrowsWithState(t, invalidCommentState, "invalidComment");
  await testThatParserThrowsWithState(t, invalidBranchPointState, "invalidBranchPoint");
  await testThatParserThrowsWithState(t, invalidEdgeState, "invalidEdge");
  await testThatParserThrowsWithState(t, invalidSelfEdgeState, "invalidSelfEdge");
  await testThatParserThrowsWithState(t, duplicateEdgeState, "duplicateEdge");
  await testThatParserThrowsWithState(t, duplicateNodeState, "duplicateNode");
  await testThatParserThrowsWithState(t, duplicateTreeState, "duplicateTree");
  await testThatParserThrowsWithState(t, missingGroupIdState, "missingGroupId");
  await testThatParserThrowsWithState(t, duplicateGroupIdState, "duplicateGroupId");
});

test("addTreesAndGroups reducer should assign new node and tree ids", t => {
  const action = SkeletonTracingActions.addTreesAndGroupsAction(
    _.cloneDeep(initialState.tracing.skeleton.trees),
    [],
  );
  const newState = SkeletonTracingReducer(initialState, action);

  t.not(newState, initialState);

  // This should be unchanged / sanity check
  t.is(newState.tracing.name, initialState.tracing.name);
  t.is(newState.tracing.activeTreeId, initialState.tracing.activeTreeId);
  // New node and tree ids should have been assigned
  t.is(_.size(newState.tracing.skeleton.trees), 4);
  t.is(newState.tracing.skeleton.trees[3].treeId, 3);
  t.is(newState.tracing.skeleton.trees[4].treeId, 4);
  t.is(newState.tracing.skeleton.trees[3].nodes.size(), 4);
  t.is(newState.tracing.skeleton.trees[3].nodes.get(8).id, 8);
  t.is(newState.tracing.skeleton.trees[3].nodes.get(9).id, 9);
  t.is(newState.tracing.skeleton.trees[4].nodes.size(), 3);
  t.is(newState.tracing.skeleton.trees[4].nodes.get(12).id, 12);

  const getSortedEdges = edges => _.sortBy(edges.asArray(), "source");

  // And node ids in edges, branchpoints and comments should have been replaced
  t.deepEqual(getSortedEdges(newState.tracing.skeleton.trees[3].edges), [
    { source: 8, target: 9 },
    { source: 9, target: 11 },
    { source: 10, target: 9 },
  ]);
  t.deepEqual(newState.tracing.skeleton.trees[3].branchPoints, [
    { nodeId: 9, timestamp: 0 },
    { nodeId: 11, timestamp: 0 },
  ]);
  t.deepEqual(newState.tracing.skeleton.trees[3].comments, [{ content: "comment", nodeId: 8 }]);
  t.deepEqual(getSortedEdges(newState.tracing.skeleton.trees[4].edges), [
    { source: 12, target: 13 },
    { source: 13, target: 14 },
  ]);
  // The cachedMaxNodeId should be correct afterwards as well
  t.is(newState.tracing.skeleton.cachedMaxNodeId, 14);
});

test("addTreesAndGroups reducer should assign new group ids", t => {
  const action = SkeletonTracingActions.addTreesAndGroupsAction(
    _.cloneDeep(initialState.tracing.skeleton.trees),
    _.cloneDeep(initialState.tracing.skeleton.treeGroups),
  );
  const newState = SkeletonTracingReducer(initialState, action);

  t.not(newState, initialState);

  // This should be unchanged / sanity check
  t.is(newState.tracing.name, initialState.tracing.name);
  t.is(newState.tracing.activeTreeId, initialState.tracing.activeTreeId);

  // New node and tree ids should have been assigned
  t.is(_.size(newState.tracing.skeleton.treeGroups), 4);
  t.not(
    newState.tracing.skeleton.treeGroups[2].groupId,
    newState.tracing.skeleton.treeGroups[0].groupId,
  );
  t.not(
    newState.tracing.skeleton.treeGroups[3].groupId,
    newState.tracing.skeleton.treeGroups[1].groupId,
  );
  t.is(newState.tracing.skeleton.trees[3].groupId, 5);
  t.is(newState.tracing.skeleton.trees[4].groupId, newState.tracing.skeleton.treeGroups[3].groupId);
});

test("addTreesAndGroups reducer should replace nodeId references in comments when changing nodeIds", t => {
  const commentWithoutValidReferences =
    "Reference to non-existing id #42 and position reference #(4,5,6)";
  const newTrees = _.cloneDeep(initialState.tracing.skeleton.trees);
  newTrees[1].comments.push({ nodeId: 1, content: "Reference to existing id in another tree #4" });
  newTrees[1].comments.push({
    nodeId: 2,
    content: commentWithoutValidReferences,
  });

  const action = SkeletonTracingActions.addTreesAndGroupsAction(newTrees, []);
  const newState = SkeletonTracingReducer(initialState, action);

  // Comments should have been rewritten if appropriate
  t.is(_.size(newState.tracing.skeleton.trees), 4);
  t.is(newState.tracing.skeleton.trees[3].comments.length, 3);
  t.is(
    newState.tracing.skeleton.trees[3].comments[1].content,
    "Reference to existing id in another tree #12",
  );
  t.is(newState.tracing.skeleton.trees[3].comments[2].content, commentWithoutValidReferences);
});

test("NML Parser should split up disconnected trees", async t => {
  const disconnectedTreeState = update(initialState, {
    tracing: {
      skeleton: {
        trees: {
          "1": { edges: { $set: EdgeCollection.loadFromArray([{ source: 0, target: 1 }]) } },
        },
      },
    },
  });

  const nmlWithDisconnectedTree = serializeToNml(
    disconnectedTreeState,
    disconnectedTreeState.tracing,
    disconnectedTreeState.tracing.skeleton,
    buildInfo,
  );
  const { trees: parsedTrees, treeGroups: parsedTreeGroups } = await parseNml(
    nmlWithDisconnectedTree,
  );

  // Check that the tree was split up into its three components
  t.is(_.size(parsedTrees), 4);
  t.true(parsedTrees[3].nodes.has(0));
  t.true(parsedTrees[3].nodes.has(1));
  t.not(parsedTrees[3].nodes.has(2));
  t.not(parsedTrees[3].nodes.has(7));
  t.is(_.size(parsedTrees[3].branchPoints), 1);
  t.is(_.size(parsedTrees[3].comments), 1);
  t.true(parsedTrees[4].nodes.has(2));
  t.true(parsedTrees[5].nodes.has(7));
  t.is(_.size(parsedTrees[5].branchPoints), 1);

  // Check that the split up trees were wrapped in a group
  // which was inserted into the original tree's group
  const parentGroup = findGroup(parsedTreeGroups, 3);
  if (parentGroup == null)
    throw Error("Assertion Error: Serialized group is missing after parsing.");
  t.is(_.size(parentGroup.children), 1);
  t.is(parentGroup.children[0].name, "TestTree-0");
});
