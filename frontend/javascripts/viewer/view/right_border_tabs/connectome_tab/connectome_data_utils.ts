import {
  getSynapseDestinations,
  getSynapsePositions,
  getSynapseSources,
  getSynapsesOfAgglomerates,
  getSynapseTypes,
} from "admin/rest_api";
import DiffableMap from "libs/diffable_map";
import { stringToAntdColorPresetRgb } from "libs/format_utils";
import Toast from "libs/toast";
import { diffArrays, map3, safeZipObject, unique } from "libs/utils";
import type { APIConnectomeFile, APIDataset, APISegmentationLayer } from "types/api_types";
import Constants, { TreeTypeEnum, type Vector3 } from "viewer/constants";
import EdgeCollection from "viewer/model/edge_collection";
import type { MutableNode, MutableTree } from "viewer/model/types/tree_types";
import type {
  Agglomerate,
  ConnectomeData,
  TreeNode,
} from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";
import { convertConnectomeToTreeData } from "viewer/view/right_border_tabs/connectome_tab/synapse_tree";
import { getBaseSegmentationName } from "viewer/view/right_border_tabs/segments_tab/segments_view_helper";

export const getSynapseIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> => {
  // Since the synapse direction filter filters the agglomerates' in/out keys and the synapse type filter
  // filters the synapses object, the two effectively need to be unioned and only the synapse ids
  // that occur in one of the agglomerates' in/out arrays as well as in the synapses object need to be returned.
  const { synapses, agglomerates } = connectomeData;
  return unique(
    Object.values(agglomerates).flatMap(
      ({ in: inSynapses = [], out: outSynapses = [] }: Agglomerate) =>
        inSynapses.concat(outSynapses),
    ),
  ).filter((synapseId) => synapses[synapseId]);
};

export const getAgglomerateIdsFromConnectomeData = (
  connectomeData: ConnectomeData,
): Array<number> => {
  // In order to find all existing agglomerate ids, the top level agglomerate ids (Object.keys(agglomerates)) need to be merged
  // with the synaptic partner agglomerate ids. The synaptic partner agglomerate ids can be found by looking at the
  // filtered set of all synapses and picking the src/dst key, depending on whether the partner is pre- or postsynaptic
  // (the other key will usually be undefined). For synapses that occur for both directions it doesn't matter, because that
  // implicates that the associated agglomerated ids both need to be top level agglomerate ids as well.
  const { synapses, agglomerates } = connectomeData;
  const topLevelAgglomerateIds = Object.keys(agglomerates).map((agglomerateId) => +agglomerateId);
  const filteredSynapseIds = getSynapseIdsFromConnectomeData(connectomeData);
  const partnerAgglomerateIds = filteredSynapseIds.map((synapseId): number => {
    const synapse = synapses[synapseId];
    if (synapse.src != null) {
      return synapse.src;
    } else if (synapse.dst) {
      return synapse.dst;
    } else {
      // Satisfy typescript
      throw new Error(`Synapse has neither source nor destination. Synapse: ${synapse}`);
    }
  });
  return unique(topLevelAgglomerateIds.concat(partnerAgglomerateIds));
};

export const getTreeNameForSynapse = (synapseId: number): string => `synapse-${synapseId}`;

export const getAgglomerateIdsFromKeys = (keys: Array<string>): Array<number> =>
  unique(keys.map((key) => +key.split(";")[1])); // The id identifying the respective agglomerate is at the second position (pattern is segment;xxx;[...])

export const synapseTreeCreator = (synapseId: number, synapseType: string): MutableTree => ({
  name: getTreeNameForSynapse(synapseId),
  treeId: synapseId,
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  color: map3((el) => el / 255, stringToAntdColorPresetRgb(synapseType)),
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  isVisible: true,
  groupId: null,
  type: TreeTypeEnum.DEFAULT,
  edgesAreVisible: true,
  metadata: [],
});

export const synapseNodeCreator = (synapseId: number, synapsePosition: Vector3): MutableNode => ({
  untransformedPosition: synapsePosition,
  radius: Constants.DEFAULT_NODE_RADIUS,
  rotation: [0, 0, 0],
  viewport: 0,
  mag: 0,
  id: synapseId,
  timestamp: Date.now(),
  bitDepth: 8,
  interpolation: false,
  // Don't assume any additionalCoordinates here, because no 4D connectomes are
  // known yet. Also see https://github.com/scalableminds/webknossos/issues/7229.
  additionalCoordinates: null,
});

export function* mapAndFilterTreeData<R>(
  nodes: Array<TreeNode>,
  callback: (arg0: TreeNode) => R,
  condition: (arg0: TreeNode) => boolean = () => true,
): Generator<R, void, void> {
  for (const node of nodes) {
    if (condition(node)) {
      yield callback(node);
    }

    if (node.children) {
      yield* mapAndFilterTreeData(node.children, callback, condition);
    }
  }
}

export function ensureTypeToString(synapseTypesAndNames: {
  synapseTypes: number[];
  typeToString: string[];
}) {
  const { synapseTypes, typeToString } = synapseTypesAndNames;

  if (typeToString.length === 0) {
    Toast.error(`Couldn't read synapseTypes mapping. Please add a json file (name should be equal to connectome file name) containing the synapseTypes next to the connectome file.
The format should be: \`{
  "synapse_type_names": [ "type1", "type2", ... ]
}\``);
    // Create mocked synapse type strings
    const largestSynapseTypeId = Math.max(...synapseTypes);
    const mockedTypeToString = [...Array(largestSynapseTypeId + 1).keys()].map(
      (i) => `type${i + 1}`,
    );
    return {
      synapseTypes,
      typeToString: mockedTypeToString,
    };
  }

  return synapseTypesAndNames;
}

export const getMappingNameFromConnectomeData = (
  connectome: ConnectomeData | null | undefined,
): string => {
  // This should never be the case, but it's not straightforward for TS to infer
  if (connectome == null) throw new Error("Connectome data was null.");
  return connectome.connectomeFile.mappingName;
};

export type ConnectomeFetchResult = {
  connectomeData: ConnectomeData;
  availableSynapseTypes: Array<string>;
  initialCheckedKeys: Array<string>;
  initialExpandedKeys: Array<string>;
};

export async function fetchConnectomeData(
  dataset: APIDataset,
  segmentationLayer: APISegmentationLayer,
  connectomeFile: APIConnectomeFile,
  activeAgglomerateIds: Array<number>,
): Promise<ConnectomeFetchResult> {
  const fetchProperties: [string, APIDataset, string, string] = [
    dataset.dataStore.url,
    dataset,
    getBaseSegmentationName(segmentationLayer),
    connectomeFile.connectomeFileName,
  ];
  const synapsesOfAgglomerates = await getSynapsesOfAgglomerates(
    ...fetchProperties,
    activeAgglomerateIds,
  );

  if (synapsesOfAgglomerates.length !== activeAgglomerateIds.length) {
    throw new Error(
      `Requested synapses of ${activeAgglomerateIds.length} agglomerate(s), but got synapses for ${synapsesOfAgglomerates.length} agglomerate(s).`,
    );
  }

  // Uniquify synapses to avoid requesting data multiple times
  const allInSynapseIds = unique(synapsesOfAgglomerates.flatMap((connections) => connections.in));
  const allOutSynapseIds = unique(synapsesOfAgglomerates.flatMap((connections) => connections.out));
  const allSynapseIds = unique([...allInSynapseIds, ...allOutSynapseIds]);
  const [synapseSources, synapseDestinations, synapsePositions, synapseTypesAndNames] =
    await Promise.all([
      getSynapseSources(...fetchProperties, allInSynapseIds),
      getSynapseDestinations(...fetchProperties, allOutSynapseIds),
      getSynapsePositions(...fetchProperties, allSynapseIds),
      getSynapseTypes(...fetchProperties, allSynapseIds),
    ]);
  // Ideally, the backend would send the typeToString mapping from the hdf5 file.
  // However, the used jhdf5 library seems to have a bug which makes it impossible to read
  // hdf5 array attributes which is why this information is read from a json file, instead.
  // Since it's easy to forget to create the json file, this code exists to act as a fail-safe.
  const { synapseTypes, typeToString } = ensureTypeToString(synapseTypesAndNames);

  const agglomerates = safeZipObject(activeAgglomerateIds, synapsesOfAgglomerates);
  const synapseIdToSource = safeZipObject(allInSynapseIds, synapseSources);
  const synapseIdToDestination = safeZipObject(allOutSynapseIds, synapseDestinations);
  const synapseIdToPosition = safeZipObject(allSynapseIds, synapsePositions);
  const synapseIdToType = safeZipObject(allSynapseIds, synapseTypes);

  const synapseObjects = allSynapseIds.map((synapseId) => ({
    id: synapseId,
    src: synapseIdToSource[synapseId],
    dst: synapseIdToDestination[synapseId],
    position: synapseIdToPosition[synapseId],
    type: typeToString[synapseIdToType[synapseId]],
  }));

  const synapses = safeZipObject(allSynapseIds, synapseObjects);

  const connectomeData = {
    agglomerates,
    synapses,
    connectomeFile,
  };
  // Auto-expand all nodes by default. The antd properties like `defaultExpandAll` only work on the first render
  // but not when switching to another agglomerate, afterwards.
  const treeData = convertConnectomeToTreeData(connectomeData) || [];
  const initialExpandedKeys = Array.from(
    mapAndFilterTreeData(
      treeData,
      (node) => node.key,
      (node) => node.data.type !== "synapse",
    ),
  );
  // Auto-load the skeletons of the active agglomerates and check all occurrences of the same agglomerate
  const topLevelCheckedKeys = treeData.map((topLevelTreeNode) => topLevelTreeNode.key);
  const initialCheckedKeys = Array.from(
    mapAndFilterTreeData(
      treeData,
      (node) => node.key,
      (node) => topLevelCheckedKeys.some((topLevelKey) => node.key.startsWith(topLevelKey)),
    ),
  );

  return {
    connectomeData,
    availableSynapseTypes: typeToString,
    initialCheckedKeys,
    initialExpandedKeys,
  };
}

export function computeSynapseTreeDiff(
  prevFilteredConnectomeData: ConnectomeData | null | undefined,
  filteredConnectomeData: ConnectomeData | null | undefined,
): { deletedSynapseIds: Array<number>; addedSynapseIds: Array<number> } {
  const prevFilteredSynapseIds =
    prevFilteredConnectomeData != null
      ? getSynapseIdsFromConnectomeData(prevFilteredConnectomeData)
      : [];
  const filteredSynapseIds =
    filteredConnectomeData != null ? getSynapseIdsFromConnectomeData(filteredConnectomeData) : [];

  const connectomeFileChanged =
    prevFilteredConnectomeData != null &&
    filteredConnectomeData != null &&
    prevFilteredConnectomeData.connectomeFile !== filteredConnectomeData.connectomeFile;

  if (connectomeFileChanged) {
    // If the connectome file has changed, all existing trees need to be removed and all non-existing
    // trees need to be newly added. Otherwise, synapse IDs of one connectome file would get mixed up
    // with synapse IDs from the other.
    return {
      deletedSynapseIds: prevFilteredSynapseIds,
      addedSynapseIds: filteredSynapseIds,
    };
  }

  // Find out which synapses were deleted and which were added
  const { onlyA: deletedSynapseIds, onlyB: addedSynapseIds } = diffArrays(
    prevFilteredSynapseIds,
    filteredSynapseIds,
  );
  return {
    deletedSynapseIds,
    addedSynapseIds,
  };
}

export type AgglomerateTreeSnapshot = {
  connectomeData: ConnectomeData | null | undefined;
  filteredConnectomeData: ConnectomeData | null | undefined;
  checkedKeys: Array<string>;
};

export function computeAgglomerateTreeDiff(
  prev: AgglomerateTreeSnapshot,
  current: AgglomerateTreeSnapshot,
): {
  deletedAgglomerateIds: Array<number>;
  hiddenAgglomerateIds: Array<number>;
  addedAgglomerateIds: Array<number>;
} {
  const {
    connectomeData: prevConnectomeData,
    filteredConnectomeData: prevFilteredConnectomeData,
    checkedKeys: prevCheckedKeys,
  } = prev;
  const { connectomeData, filteredConnectomeData, checkedKeys } = current;
  const prevFilteredAgglomerateIds =
    prevFilteredConnectomeData != null
      ? getAgglomerateIdsFromConnectomeData(prevFilteredConnectomeData)
      : [];
  const filteredAgglomerateIds =
    filteredConnectomeData != null
      ? getAgglomerateIdsFromConnectomeData(filteredConnectomeData)
      : [];
  const prevUnfilteredAgglomerateIds =
    prevConnectomeData != null ? getAgglomerateIdsFromConnectomeData(prevConnectomeData) : [];
  const unfilteredAgglomerateIds =
    connectomeData != null ? getAgglomerateIdsFromConnectomeData(connectomeData) : [];

  const checkedAgglomerateIds = getAgglomerateIdsFromKeys(checkedKeys);
  const visibleAgglomerateIds = checkedAgglomerateIds.filter((agglomerateId) =>
    filteredAgglomerateIds.includes(agglomerateId),
  );

  const connectomeFileMappingChanged =
    prevConnectomeData != null &&
    connectomeData != null &&
    prevConnectomeData.connectomeFile.mappingName !== connectomeData.connectomeFile.mappingName;

  if (connectomeFileMappingChanged) {
    // If the connectome file's mapping has changed, all existing trees need to be removed
    // and all non-existing trees need to be newly added.
    // Otherwise, agglomerate IDs of one mapping file would get mixed up with agglomerate IDs
    // from the other.
    // If the connectome file has changed but the mapping file remained the same, the agglomerate
    // skeletons can be reused since they are the same.
    return {
      deletedAgglomerateIds: prevUnfilteredAgglomerateIds,
      hiddenAgglomerateIds: [],
      addedAgglomerateIds: visibleAgglomerateIds,
    };
  }

  const prevCheckedAgglomerateIds = getAgglomerateIdsFromKeys(prevCheckedKeys);
  // Find out which agglomerates were deleted
  const { onlyA: deletedAgglomerateIds } = diffArrays(
    prevUnfilteredAgglomerateIds,
    unfilteredAgglomerateIds,
  );
  const prevVisibleAgglomerateIds = prevCheckedAgglomerateIds.filter((agglomerateId) =>
    prevFilteredAgglomerateIds.includes(agglomerateId),
  );
  // Find out which agglomerates were hidden or added by filtering/checking
  const { onlyA: hiddenAgglomerateIds, onlyB: addedAgglomerateIds } = diffArrays(
    prevVisibleAgglomerateIds,
    visibleAgglomerateIds,
  );
  return {
    deletedAgglomerateIds,
    hiddenAgglomerateIds,
    addedAgglomerateIds,
  };
}
