import type { APIConnectomeFile } from "types/api_types";
import {
  computeAgglomerateTreeDiff,
  computeSynapseTreeDiff,
  ensureTypeToString,
  getAgglomerateIdsFromConnectomeData,
  getAgglomerateIdsFromKeys,
  getSynapseIdsFromConnectomeData,
  mapAndFilterTreeData,
} from "viewer/view/right_border_tabs/connectome_tab/connectome_data_utils";
import type {
  ConnectomeData,
  Synapse,
  TreeNode,
} from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";
import { describe, expect, it } from "vitest";

const connectomeFileA: APIConnectomeFile = {
  connectomeFileName: "connectome_a",
  mappingName: "mapping_a",
};
const connectomeFileB: APIConnectomeFile = {
  connectomeFileName: "connectome_b",
  mappingName: "mapping_b",
};
const connectomeFileBWithMappingA: APIConnectomeFile = {
  connectomeFileName: "connectome_b",
  mappingName: "mapping_a",
};

const inSynapse = (id: number, src: number): Synapse =>
  ({
    id,
    src,
    dst: undefined,
    position: [0, 0, 0],
    type: "synaptic",
  }) as unknown as Synapse;

const outSynapse = (id: number, dst: number): Synapse =>
  ({
    id,
    src: undefined,
    dst,
    position: [0, 0, 0],
    type: "synaptic",
  }) as unknown as Synapse;

// Agglomerate 10 has incoming synapses 1 (from 20) and 2 (from 21),
// and outgoing synapse 3 (to 22).
const connectomeData: ConnectomeData = {
  agglomerates: {
    10: {
      in: [1, 2],
      out: [3],
    },
  },
  synapses: {
    1: inSynapse(1, 20),
    2: inSynapse(2, 21),
    3: outSynapse(3, 22),
  },
  connectomeFile: connectomeFileA,
};

// The same connectome data, but with synapse 2 filtered out (e.g. by synapse type).
const filteredConnectomeData: ConnectomeData = {
  agglomerates: connectomeData.agglomerates,
  synapses: {
    1: connectomeData.synapses[1],
    3: connectomeData.synapses[3],
  },
  connectomeFile: connectomeFileA,
};

describe("getSynapseIdsFromConnectomeData", () => {
  it("returns all synapse ids referenced by the agglomerates", () => {
    expect(getSynapseIdsFromConnectomeData(connectomeData)).toEqual([1, 2, 3]);
  });

  it("omits synapse ids that were filtered from the synapses object", () => {
    expect(getSynapseIdsFromConnectomeData(filteredConnectomeData)).toEqual([1, 3]);
  });

  it("omits synapse ids whose direction was filtered from the agglomerates", () => {
    const directionFiltered: ConnectomeData = {
      ...connectomeData,
      agglomerates: {
        10: {
          in: [1, 2],
        } as ConnectomeData["agglomerates"][number],
      },
    };
    expect(getSynapseIdsFromConnectomeData(directionFiltered)).toEqual([1, 2]);
  });
});

describe("getAgglomerateIdsFromConnectomeData", () => {
  it("returns the top-level agglomerates and all synaptic partners", () => {
    expect(getAgglomerateIdsFromConnectomeData(connectomeData)).toEqual([10, 20, 21, 22]);
  });

  it("omits partners whose synapses were filtered out", () => {
    expect(getAgglomerateIdsFromConnectomeData(filteredConnectomeData)).toEqual([10, 20, 22]);
  });
});

describe("getAgglomerateIdsFromKeys", () => {
  it("extracts the unique agglomerate ids from tree keys", () => {
    expect(
      getAgglomerateIdsFromKeys(["segment;10;", "segment;20;in;10;", "segment;10;out;22;"]),
    ).toEqual([10, 20]);
  });
});

describe("mapAndFilterTreeData", () => {
  const treeNode = (key: string, children: Array<TreeNode> = []): TreeNode => ({
    key,
    title: key,
    children,
    data: {
      type: "none",
      id: 0,
    },
  });
  const treeData = [treeNode("a", [treeNode("a1"), treeNode("a2")]), treeNode("b")];

  it("visits all nodes recursively", () => {
    expect(Array.from(mapAndFilterTreeData(treeData, (node) => node.key))).toEqual([
      "a",
      "a1",
      "a2",
      "b",
    ]);
  });

  it("applies the condition to each node", () => {
    expect(
      Array.from(
        mapAndFilterTreeData(
          treeData,
          (node) => node.key,
          (node) => node.key !== "a1",
        ),
      ),
    ).toEqual(["a", "a2", "b"]);
  });
});

describe("ensureTypeToString", () => {
  it("passes through a valid typeToString mapping", () => {
    const input = {
      synapseTypes: [0, 1],
      typeToString: ["excitatory", "inhibitory"],
    };
    expect(ensureTypeToString(input)).toBe(input);
  });

  it("creates a mocked mapping if typeToString is empty", () => {
    const { typeToString } = ensureTypeToString({
      synapseTypes: [0, 2],
      typeToString: [],
    });
    expect(typeToString).toEqual(["type1", "type2", "type3"]);
  });
});

describe("computeSynapseTreeDiff", () => {
  it("computes added synapses when starting from no data", () => {
    expect(computeSynapseTreeDiff(null, connectomeData)).toEqual({
      deletedSynapseIds: [],
      addedSynapseIds: [1, 2, 3],
    });
  });

  it("computes deleted synapses when the data is reset", () => {
    expect(computeSynapseTreeDiff(connectomeData, null)).toEqual({
      deletedSynapseIds: [1, 2, 3],
      addedSynapseIds: [],
    });
  });

  it("computes the minimal diff when synapses are filtered", () => {
    expect(computeSynapseTreeDiff(connectomeData, filteredConnectomeData)).toEqual({
      deletedSynapseIds: [2],
      addedSynapseIds: [],
    });
  });

  it("recreates all trees when the connectome file changed", () => {
    const otherFileData: ConnectomeData = {
      ...connectomeData,
      connectomeFile: connectomeFileB,
    };
    // Without a connectome file change, identical synapse ids would yield an empty diff.
    // With one, all trees need to be deleted and recreated to avoid mixing up ids.
    expect(computeSynapseTreeDiff(connectomeData, otherFileData)).toEqual({
      deletedSynapseIds: [1, 2, 3],
      addedSynapseIds: [1, 2, 3],
    });
  });
});

describe("computeAgglomerateTreeDiff", () => {
  const allKeys = ["segment;10;", "segment;20;in;10;", "segment;21;in;10;", "segment;22;out;10;"];

  const snapshot = (
    data: ConnectomeData | null,
    filteredData: ConnectomeData | null,
    checkedKeys: Array<string>,
  ) => ({
    connectomeData: data,
    filteredConnectomeData: filteredData,
    checkedKeys,
  });
  const emptySnapshot = snapshot(null, null, []);

  it("adds all checked agglomerates when starting from no data", () => {
    expect(
      computeAgglomerateTreeDiff(emptySnapshot, snapshot(connectomeData, connectomeData, allKeys)),
    ).toEqual({
      deletedAgglomerateIds: [],
      hiddenAgglomerateIds: [],
      addedAgglomerateIds: [10, 20, 21, 22],
    });
  });

  it("only adds checked agglomerates that are not filtered out", () => {
    expect(
      computeAgglomerateTreeDiff(
        emptySnapshot,
        snapshot(connectomeData, filteredConnectomeData, allKeys),
      ),
    ).toEqual({
      deletedAgglomerateIds: [],
      hiddenAgglomerateIds: [],
      addedAgglomerateIds: [10, 20, 22],
    });
  });

  it("deletes all agglomerates when the data is reset", () => {
    expect(
      computeAgglomerateTreeDiff(snapshot(connectomeData, connectomeData, allKeys), emptySnapshot),
    ).toEqual({
      deletedAgglomerateIds: [10, 20, 21, 22],
      // Deleted agglomerates are also reported as hidden. This is harmless because
      // the deletion is dispatched before the visibility update, which then no-ops.
      hiddenAgglomerateIds: [10, 20, 21, 22],
      addedAgglomerateIds: [],
    });
  });

  it("hides agglomerates that are unchecked but keeps their trees", () => {
    const keysWithout21 = allKeys.filter((key) => !key.startsWith("segment;21;"));
    expect(
      computeAgglomerateTreeDiff(
        snapshot(connectomeData, connectomeData, allKeys),
        snapshot(connectomeData, connectomeData, keysWithout21),
      ),
    ).toEqual({
      deletedAgglomerateIds: [],
      hiddenAgglomerateIds: [21],
      addedAgglomerateIds: [],
    });
  });

  it("hides agglomerates whose synapses were filtered out", () => {
    expect(
      computeAgglomerateTreeDiff(
        snapshot(connectomeData, connectomeData, allKeys),
        snapshot(connectomeData, filteredConnectomeData, allKeys),
      ),
    ).toEqual({
      deletedAgglomerateIds: [],
      hiddenAgglomerateIds: [21],
      addedAgglomerateIds: [],
    });
  });

  it("recreates all trees when the mapping of the connectome file changed", () => {
    const otherMappingData: ConnectomeData = {
      ...connectomeData,
      connectomeFile: connectomeFileB,
    };
    expect(
      computeAgglomerateTreeDiff(
        snapshot(connectomeData, connectomeData, allKeys),
        snapshot(otherMappingData, otherMappingData, allKeys),
      ),
    ).toEqual({
      deletedAgglomerateIds: [10, 20, 21, 22],
      hiddenAgglomerateIds: [],
      addedAgglomerateIds: [10, 20, 21, 22],
    });
  });

  it("reuses the trees when the connectome file changed but the mapping stayed the same", () => {
    const otherFileSameMappingData: ConnectomeData = {
      ...connectomeData,
      connectomeFile: connectomeFileBWithMappingA,
    };
    expect(
      computeAgglomerateTreeDiff(
        snapshot(connectomeData, connectomeData, allKeys),
        snapshot(otherFileSameMappingData, otherFileSameMappingData, allKeys),
      ),
    ).toEqual({
      deletedAgglomerateIds: [],
      hiddenAgglomerateIds: [],
      addedAgglomerateIds: [],
    });
  });
});
