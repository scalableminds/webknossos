import _ from "lodash";
import update from "immutability-helper";
import type { Node, SkeletonTracing, WebknossosState } from "viewer/store";
import defaultState from "viewer/default_state";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "viewer/model/edge_collection";
import { findGroup } from "viewer/view/right-border-tabs/trees_tab/tree_hierarchy_view_helpers";
import { describe, it, expect } from "vitest";
import { TreeTypeEnum } from "viewer/constants";
import { addTreesAndGroupsAction } from "viewer/model/actions/skeletontracing_actions";
import { serializeToNml, getNmlName, parseNml } from "viewer/model/helpers/nml_helpers";
import SkeletonTracingReducer from "viewer/model/reducers/skeletontracing_reducer";
import { enforceSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { annotation as TASK_ANNOTATION } from "../fixtures/tasktracing_server_objects";
import { buildInfo as BUILD_INFO } from "../fixtures/build_info";

const createDummyNode = (id: number): Node => ({
  bitDepth: 8,
  id,
  untransformedPosition: [id, id, id],
  additionalCoordinates: [],
  radius: id,
  mag: 10,
  rotation: [id, id, id],
  timestamp: id,
  viewport: 1,
  interpolation: id % 2 === 0,
});

const initialSkeletonTracing: SkeletonTracing = {
  type: "skeleton",
  createdTimestamp: 0,
  tracingId: "tracingId",
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
      branchPoints: [
        {
          nodeId: 1,
          timestamp: 0,
        },
        {
          nodeId: 7,
          timestamp: 0,
        },
      ],
      edges: EdgeCollection.loadFromArray([
        {
          source: 0,
          target: 1,
        },
        {
          source: 2,
          target: 1,
        },
        {
          source: 1,
          target: 7,
        },
      ]),
      comments: [
        {
          content: "comment",
          nodeId: 0,
        },
      ],
      color: [0.09019607843137255, 0.09019607843137255, 0.09019607843137255],
      isVisible: true,
      groupId: 3,
      type: TreeTypeEnum.DEFAULT,
      edgesAreVisible: true,
      metadata: [],
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
      edges: EdgeCollection.loadFromArray([
        {
          source: 4,
          target: 5,
        },
        {
          source: 5,
          target: 6,
        },
      ]),
      comments: [],
      color: [0.11764705882352941, 0.11764705882352941, 0.11764705882352941],
      isVisible: true,
      groupId: 2,
      type: TreeTypeEnum.DEFAULT,
      edgesAreVisible: true,
      metadata: [],
    },
  },
  treeGroups: [
    {
      groupId: 1,
      name: "Axon 1",
      isExpanded: true,
      children: [
        {
          groupId: 3,
          name: "Blah",
          children: [],
          isExpanded: false,
        },
      ],
    },
    {
      groupId: 2,
      name: "Axon 2",
      children: [],
      isExpanded: true,
    },
  ],
  activeTreeId: 1,
  activeNodeId: 1,
  activeGroupId: null,
  boundingBox: {
    min: [0, 0, 0],
    max: [500, 500, 500],
  },
  userBoundingBoxes: [
    {
      id: 10,
      boundingBox: {
        min: [5, 5, 5],
        max: [250, 250, 250],
      },
      name: "Test Bounding Box",
      color: [1, 0, 0],
      isVisible: true,
    },
  ],
  navigationList: {
    list: [],
    activeIndex: -1,
  },
  showSkeletons: true,
  additionalAxes: [],
};

const initialState: WebknossosState = _.extend({}, defaultState, {
  dataset: {
    ...defaultState.dataset,
    name: "Test Dataset",
  },
  annotation: {
    name: "",
    restrictions: {
      branchPointsAllowed: true,
      allowUpdate: true,
      allowFinish: true,
      allowAccess: true,
      allowDownload: true,
    },
    skeleton: initialSkeletonTracing,
    annotationType: "Explorational",
    annotationId: "annotationId",
  },
  task: TASK_ANNOTATION.task,
});

async function testThatParserThrowsWithState(invalidState: WebknossosState, key: string) {
  // Serialize the NML using the invalidState, then parse it again, which should throw an NMLParseError
  const nmlWithInvalidContent = serializeToNml(
    invalidState,
    invalidState.annotation,
    enforceSkeletonTracing(invalidState.annotation),
    BUILD_INFO,
    false,
  );
  await throwsAsyncParseError(() => parseNml(nmlWithInvalidContent), key);
}

async function throwsAsyncParseError(fn: () => void, key: string) {
  try {
    await fn();
    expect.fail(`Test did not throw, calling the function with the following key: ${key}`);
  } catch (e) {
    if (e instanceof Error && e.name === "NmlParseError") {
      expect(true).toBe(true);
    } else {
      throw e;
    }
  }
}

describe("NML", () => {
  it("serializing and parsing should yield the same state", async () => {
    const serializedNml = serializeToNml(
      initialState,
      initialState.annotation,
      enforceSkeletonTracing(initialState.annotation),
      BUILD_INFO,
      false,
    );
    const { trees, treeGroups } = await parseNml(serializedNml);
    expect(initialSkeletonTracing.trees).toEqual(trees);
    expect(initialSkeletonTracing.treeGroups).toEqual(treeGroups);
  });

  it("serializing and parsing should yield the same state even when using special characters", async () => {
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              comments: {
                $push: [
                  {
                    nodeId: 1,
                    content: "Hello\"a'b<c>d&e\"f'g<h>i&j",
                  },
                ],
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    const { trees, treeGroups } = await parseNml(serializedNml);
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    expect(skeletonTracing.trees).toEqual(trees);
    expect(skeletonTracing.treeGroups).toEqual(treeGroups);
  });

  it("serializing and parsing should yield the same state even when using multiline attributes", async () => {
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              comments: {
                $push: [
                  {
                    nodeId: 1,
                    content: "Hello\nfrom\nthe\nother\nside.",
                  },
                ],
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    const { trees, treeGroups } = await parseNml(serializedNml);
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    expect(skeletonTracing.trees).toEqual(trees);
    expect(skeletonTracing.treeGroups).toEqual(treeGroups);
  });

  it("serializing and parsing should yield the same state even when additional coordinates exist", async () => {
    const existingNodeMap = initialState.annotation.skeleton?.trees[1].nodes;
    if (existingNodeMap == null) {
      throw new Error("Unexpected null value.");
    }
    const existingNode = existingNodeMap.getOrThrow(1);
    const newNodeMap = existingNodeMap.set(1, {
      ...existingNode,
      additionalCoordinates: [{ name: "t", value: 123 }],
    });
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              nodes: {
                $set: newNodeMap,
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    const { trees, treeGroups } = await parseNml(serializedNml);
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    expect(skeletonTracing.trees).toEqual(trees);
    expect(skeletonTracing.treeGroups).toEqual(treeGroups);
  });

  it("NML Serializer should only serialize visible trees", async () => {
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              isVisible: {
                $set: false,
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    const { trees } = await parseNml(serializedNml);
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    // Tree 1 should not be exported as it is not visible
    delete skeletonTracing.trees["1"];
    expect(Object.keys(skeletonTracing.trees)).toEqual(Object.keys(trees));
    expect(skeletonTracing.trees).toEqual(trees);
  });

  it("NML Serializer should only serialize groups with visible trees", async () => {
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              isVisible: {
                $set: false,
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    const { treeGroups } = await parseNml(serializedNml);
    const skeletonTracing = enforceSkeletonTracing(state.annotation);
    // Group 1 (and group 3 and 4 which are children of group 1) should not be exported as they do not contain a visible tree
    const expectedTreeGroups = skeletonTracing.treeGroups.filter((group) => group.groupId !== 1);
    expect(expectedTreeGroups).toEqual(treeGroups);
  });

  it("NML serializer should produce correct NMLs", () => {
    const serializedNml = serializeToNml(
      initialState,
      initialState.annotation,
      enforceSkeletonTracing(initialState.annotation),
      BUILD_INFO,
      false,
    );
    expect(serializedNml).toMatchSnapshot();
  });

  it("NML serializer should produce correct NMLs with additional coordinates", () => {
    let adaptedState = update(initialState, {
      annotation: {
        skeleton: {
          additionalAxes: {
            $set: [{ name: "t", bounds: [0, 100], index: 0 }],
          },
        },
      },
    });

    const existingNodeMap = adaptedState.annotation.skeleton?.trees[1].nodes;
    if (existingNodeMap == null) {
      throw new Error("Unexpected null value.");
    }
    const existingNode = existingNodeMap.getOrThrow(1);
    const newNodeMap = existingNodeMap.set(1, {
      ...existingNode,
      additionalCoordinates: [{ name: "t", value: 123 }],
    });
    adaptedState = update(adaptedState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              nodes: {
                $set: newNodeMap,
              },
            },
          },
        },
      },
    });

    const serializedNml = serializeToNml(
      adaptedState,
      adaptedState.annotation,
      enforceSkeletonTracing(adaptedState.annotation),
      BUILD_INFO,
      false,
    );
    expect(serializedNml).toMatchSnapshot();
  });

  it("NML serializer should produce correct NMLs with metadata for trees", async () => {
    const properties = [
      {
        key: "key of string",
        stringValue: "string value",
      },
      {
        key: "key of true",
        boolValue: true,
      },
      {
        key: "key of false",
        boolValue: false,
      },
      {
        key: "key of number",
        numberValue: 1234,
      },
      {
        key: "key of string list",
        stringListValue: ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"],
      },
    ];
    const state = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              metadata: {
                $set: properties,
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );

    expect(serializedNml).toContain(
      '<metadataEntry key="key of string" stringValue="string value" />',
    );

    expect(serializedNml).toContain('<metadataEntry key="key of true" boolValue="true" />');
    expect(serializedNml).toContain('<metadataEntry key="key of false" boolValue="false" />');
    expect(serializedNml).toContain('<metadataEntry key="key of number" numberValue="1234" />');
    expect(serializedNml).toContain(
      '<metadataEntry key="key of string list" stringListValue-0="1" stringListValue-1="2" stringListValue-2="3" stringListValue-3="4" stringListValue-4="5" stringListValue-5="6" stringListValue-6="7" stringListValue-7="8" stringListValue-8="9" stringListValue-9="10" stringListValue-10="11" />',
    );

    const { trees } = await parseNml(serializedNml);
    if (state.annotation.skeleton == null) {
      throw new Error("Unexpected null for skeleton");
    }
    expect(state.annotation.skeleton.trees[1]).toEqual(trees[1]);
  });

  it("NML serializer should escape special characters and multilines", () => {
    const state = update(initialState, {
      annotation: {
        description: {
          $set: "Multiline dataset\ndescription\nwith special &'<>\" chars.",
        },
        skeleton: {
          trees: {
            "1": {
              comments: {
                $push: [
                  {
                    nodeId: 1,
                    content: "Hello\"a'b<c>d&e\"f'g<h>i&j\nwith\nnew\nlines",
                  },
                ],
              },
            },
          },
        },
      },
    });
    const serializedNml = serializeToNml(
      state,
      state.annotation,
      enforceSkeletonTracing(state.annotation),
      BUILD_INFO,
      false,
    );
    // Explicitly check for the encoded characters
    expect(
      serializedNml.indexOf(
        "Hello&quot;a&apos;b&lt;c&gt;d&amp;e&quot;f&apos;g&lt;h&gt;i&amp;j&#xa;with&#xa;new&#xa;lines",
      ) > -1,
    ).toBe(true);
    expect(serializedNml).toMatchSnapshot();
  });

  it("Serialized nml should be correctly named", async () => {
    expect(getNmlName(initialState)).toBe("Test Dataset__5b1fd1cb97000027049c67ec____tionId.nml");

    const stateWithoutTask = { ...initialState, task: null };

    expect(getNmlName(stateWithoutTask)).toBe("Test Dataset__explorational____tionId.nml");
  });

  it("NML Parser should throw errors for invalid nmls", async () => {
    const invalidCommentState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "2": {
              comments: {
                $set: [
                  {
                    content: "test",
                    nodeId: 99,
                  },
                ],
              },
            },
          },
        },
      },
    });
    const invalidBranchPointState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "2": {
              branchPoints: {
                $set: [
                  {
                    timestamp: 0,
                    nodeId: 99,
                  },
                ],
              },
            },
          },
        },
      },
    });
    const invalidEdgeState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "2": {
              edges: {
                $set: EdgeCollection.loadFromArray([
                  {
                    source: 99,
                    target: 5,
                  },
                ]),
              },
            },
          },
        },
      },
    });
    const invalidSelfEdgeState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "2": {
              edges: {
                $set: EdgeCollection.loadFromArray([
                  {
                    source: 4,
                    target: 5,
                  },
                  {
                    source: 5,
                    target: 6,
                  },
                  {
                    source: 6,
                    target: 6,
                  },
                ]),
              },
            },
          },
        },
      },
    });
    const duplicateEdgeState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "2": {
              edges: {
                $set: EdgeCollection.loadFromArray([
                  {
                    source: 4,
                    target: 5,
                  },
                  {
                    source: 4,
                    target: 5,
                  },
                  {
                    source: 5,
                    target: 6,
                  },
                ]),
              },
            },
          },
        },
      },
    });
    const duplicateNodeState = update(initialState, {
      annotation: {
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
      annotation: {
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
      annotation: {
        skeleton: {
          trees: {
            "2": {
              groupId: {
                $set: 9999,
              },
            },
          },
        },
      },
    });
    const duplicateGroupIdState = update(initialState, {
      annotation: {
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
    await testThatParserThrowsWithState(invalidCommentState, "invalidComment");
    await testThatParserThrowsWithState(invalidBranchPointState, "invalidBranchPoint");
    await testThatParserThrowsWithState(invalidEdgeState, "invalidEdge");
    await testThatParserThrowsWithState(invalidSelfEdgeState, "invalidSelfEdge");
    await testThatParserThrowsWithState(duplicateEdgeState, "duplicateEdge");
    await testThatParserThrowsWithState(duplicateNodeState, "duplicateNode");
    await testThatParserThrowsWithState(duplicateTreeState, "duplicateTree");
    await testThatParserThrowsWithState(missingGroupIdState, "missingGroupId");
    await testThatParserThrowsWithState(duplicateGroupIdState, "duplicateGroupId");
  });

  it("addTreesAndGroups reducer should assign new node and tree ids", () => {
    const action = addTreesAndGroupsAction(_.cloneDeep(initialSkeletonTracing.trees), []);
    const newState = SkeletonTracingReducer(initialState, action);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    // This should be unchanged / sanity check
    expect(newState.annotation.name).toBe(initialState.annotation.name);
    expect(newSkeletonTracing.activeTreeId).toBe(initialSkeletonTracing.activeTreeId);
    // New node and tree ids should have been assigned
    expect(_.size(newSkeletonTracing.trees)).toBe(4);
    expect(newSkeletonTracing.trees[3].treeId).toBe(3);
    expect(newSkeletonTracing.trees[4].treeId).toBe(4);
    expect(newSkeletonTracing.trees[3].nodes.size()).toBe(4);
    expect(newSkeletonTracing.trees[3].nodes.getOrThrow(8).id).toBe(8);
    expect(newSkeletonTracing.trees[3].nodes.getOrThrow(9).id).toBe(9);
    expect(newSkeletonTracing.trees[4].nodes.size()).toBe(3);
    expect(newSkeletonTracing.trees[4].nodes.getOrThrow(12).id).toBe(12);

    const getSortedEdges = (edges: EdgeCollection) => _.sortBy(edges.asArray(), "source");

    // And node ids in edges, branchpoints and comments should have been replaced
    expect(getSortedEdges(newSkeletonTracing.trees[3].edges)).toEqual([
      {
        source: 8,
        target: 9,
      },
      {
        source: 9,
        target: 11,
      },
      {
        source: 10,
        target: 9,
      },
    ]);
    expect(newSkeletonTracing.trees[3].branchPoints).toEqual([
      {
        nodeId: 9,
        timestamp: 0,
      },
      {
        nodeId: 11,
        timestamp: 0,
      },
    ]);
    expect(newSkeletonTracing.trees[3].comments).toEqual([
      {
        content: "comment",
        nodeId: 8,
      },
    ]);
    expect(getSortedEdges(newSkeletonTracing.trees[4].edges)).toEqual([
      {
        source: 12,
        target: 13,
      },
      {
        source: 13,
        target: 14,
      },
    ]);
    // The cachedMaxNodeId should be correct afterwards as well
    expect(newSkeletonTracing.cachedMaxNodeId).toBe(14);
  });

  it("addTreesAndGroups reducer should assign new group ids", () => {
    const action = addTreesAndGroupsAction(
      _.cloneDeep(initialSkeletonTracing.trees),
      _.cloneDeep(initialSkeletonTracing.treeGroups),
    );
    const newState = SkeletonTracingReducer(initialState, action);
    expect(newState).not.toBe(initialState);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    // This should be unchanged / sanity check
    expect(newState.annotation.name).toBe(initialState.annotation.name);
    expect(newSkeletonTracing.activeTreeId).toBe(initialSkeletonTracing.activeTreeId);
    // New node and tree ids should have been assigned
    expect(_.size(newSkeletonTracing.treeGroups)).toBe(4);
    expect(newSkeletonTracing.treeGroups[2].groupId).not.toBe(
      newSkeletonTracing.treeGroups[0].groupId,
    );
    expect(newSkeletonTracing.treeGroups[3].groupId).not.toBe(
      newSkeletonTracing.treeGroups[1].groupId,
    );
    expect(newSkeletonTracing.trees[3].groupId).toBe(5);
    expect(newSkeletonTracing.trees[4].groupId).toBe(newSkeletonTracing.treeGroups[3].groupId);
  });

  it("addTreesAndGroups reducer should replace nodeId references in comments when changing nodeIds", () => {
    const commentWithoutValidReferences =
      "Reference to non-existing id #42 and position reference #(4,5,6)";

    const newTrees = _.cloneDeep(initialSkeletonTracing.trees);

    newTrees[1].comments.push({
      nodeId: 1,
      content: "Reference to existing id in another tree #4",
    });
    newTrees[1].comments.push({
      nodeId: 2,
      content: commentWithoutValidReferences,
    });
    const action = addTreesAndGroupsAction(newTrees, []);
    const newState = SkeletonTracingReducer(initialState, action);
    const newSkeletonTracing = enforceSkeletonTracing(newState.annotation);
    // Comments should have been rewritten if appropriate
    expect(_.size(newSkeletonTracing.trees)).toBe(4);
    expect(newSkeletonTracing.trees[3].comments.length).toBe(3);
    expect(newSkeletonTracing.trees[3].comments[1].content).toBe(
      "Reference to existing id in another tree #12",
    );
    expect(newSkeletonTracing.trees[3].comments[2].content).toBe(commentWithoutValidReferences);
  });

  it("NML Parser should split up disconnected trees", async () => {
    const disconnectedTreeState = update(initialState, {
      annotation: {
        skeleton: {
          trees: {
            "1": {
              edges: {
                $set: EdgeCollection.loadFromArray([
                  {
                    source: 0,
                    target: 1,
                  },
                ]),
              },
            },
          },
        },
      },
    });
    const nmlWithDisconnectedTree = serializeToNml(
      disconnectedTreeState,
      disconnectedTreeState.annotation,
      enforceSkeletonTracing(disconnectedTreeState.annotation),
      BUILD_INFO,
      false,
    );
    const { trees: parsedTrees, treeGroups: parsedTreeGroups } =
      await parseNml(nmlWithDisconnectedTree);
    // Check that the tree was split up into its three components
    expect(_.size(parsedTrees)).toBe(4);
    expect(parsedTrees[3].nodes.has(0)).toBe(true);
    expect(parsedTrees[3].nodes.has(1)).toBe(true);
    expect(parsedTrees[3].nodes.has(2)).toBe(false);
    expect(parsedTrees[3].nodes.has(7)).toBe(false);
    expect(_.size(parsedTrees[3].branchPoints)).toBe(1);
    expect(_.size(parsedTrees[3].comments)).toBe(1);
    expect(parsedTrees[4].nodes.has(2)).toBe(true);
    expect(parsedTrees[5].nodes.has(7)).toBe(true);
    expect(_.size(parsedTrees[5].branchPoints)).toBe(1);
    // Check that the split up trees were wrapped in a group
    // which was inserted into the original tree's group
    const parentGroup = findGroup(parsedTreeGroups, 3);
    if (parentGroup == null)
      throw Error("Assertion Error: Serialized group is missing after parsing.");
    expect(_.size(parentGroup.children)).toBe(1);
    expect(parentGroup.children[0].name).toBe("TestTree-0");
  });
});
