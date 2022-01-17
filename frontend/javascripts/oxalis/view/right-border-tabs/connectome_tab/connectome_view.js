// @flow
import { Alert, Empty, Input, Tooltip } from "antd";
import { connect } from "react-redux";
import Maybe from "data.maybe";
import React from "react";
import _ from "lodash";

import type { APISegmentationLayer, APIDataset, APIConnectomeFile } from "types/api_flow_types";
import { diffArrays, unique, map3 } from "libs/utils";
import { getTreeNameForAgglomerateSkeleton } from "oxalis/model/accessors/skeletontracing_accessor";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import {
  getSynapsesOfAgglomerates,
  getSynapseSources,
  getSynapseDestinations,
  getSynapsePositions,
  getSynapseTypes,
} from "admin/admin_rest_api";
import {
  getVisibleOrLastSegmentationLayer,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  initializeConnectomeTracingAction,
  removeConnectomeTracingAction,
  deleteConnectomeTreesAction,
  addConnectomeTreesAction,
  setConnectomeTreesVisibilityAction,
  setActiveConnectomeAgglomerateIdsAction,
} from "oxalis/model/actions/connectome_actions";
import {
  loadAgglomerateSkeletonAction,
  removeAgglomerateSkeletonAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { stringToAntdColorPresetRgb } from "libs/format_utils";
import { setMappingAction } from "oxalis/model/actions/settings_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import Constants, { type Vector3, MappingStatusEnum } from "oxalis/constants";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import InputComponent from "oxalis/view/components/input_component";
import Store, {
  type OxalisState,
  type MutableTree,
  type MutableNode,
  type MutableTreeMap,
  type ActiveMappingInfo,
} from "oxalis/store";
import Toast from "libs/toast";
import getSceneController from "oxalis/controller/scene_controller_provider";
import SynapseTree, {
  type ConnectomeData,
  type Agglomerate,
  type TreeNode,
  convertConnectomeToTreeData,
} from "oxalis/view/right-border-tabs/connectome_tab/synapse_tree";
import ConnectomeFilters from "oxalis/view/right-border-tabs/connectome_tab/connectome_filters";
import ConnectomeSettings from "oxalis/view/right-border-tabs/connectome_tab/connectome_settings";

const connectomeTabId = "connectome-view";

type StateProps = {|
  dataset: APIDataset,
  // segmentationLayer will be the visible segmentation layer, or if there is none,
  // the segmentation layer that was last visible. This is done to allow toggling
  // the segmentation layer while browsing a connectome.
  segmentationLayer: ?APISegmentationLayer,
  currentConnectomeFile: ?APIConnectomeFile,
  activeAgglomerateIds: Array<number>,
  mappingInfo: ?ActiveMappingInfo,
|};

const mapStateToProps = (state: OxalisState): StateProps => {
  const segmentationLayer = getVisibleOrLastSegmentationLayer(state);
  const connectomeData =
    segmentationLayer != null
      ? state.localSegmentationData[segmentationLayer.name].connectomeData
      : null;
  const mappingInfo =
    segmentationLayer != null
      ? getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, segmentationLayer.name)
      : null;
  return {
    dataset: state.dataset,
    segmentationLayer,
    currentConnectomeFile: connectomeData != null ? connectomeData.currentConnectomeFile : null,
    activeAgglomerateIds: connectomeData != null ? connectomeData.activeAgglomerateIds : [],
    mappingInfo,
  };
};

type Props = StateProps;

type State = {
  connectomeData: ?ConnectomeData,
  filteredConnectomeData: ?ConnectomeData,
  availableSynapseTypes: Array<string>,
  checkedKeys: Array<string>,
  expandedKeys: Array<string>,
};

const getSynapseIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> => {
  // Since the synapse direction filter filters the agglomerates' in/out keys and the synapse type filter
  // filters the synapses object, the two effectively need to be unioned and only the synapse ids
  // that occur in one of the agglomerates' in/out arrays as well as in the synapses object need to be returned.
  const { synapses, agglomerates } = connectomeData;
  return unique(
    Object.values(agglomerates).flatMap(
      // $FlowIssue[incompatible-call] remove once https://github.com/facebook/flow/issues/2221 is fixed
      ({ in: inSynapses = [], out: outSynapses = [] }: Agglomerate) =>
        inSynapses.concat(outSynapses),
    ),
  ).filter(synapseId => synapses[synapseId]);
};

const getAgglomerateIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> => {
  // In order to find all existing agglomerate ids, the top level agglomerate ids (Object.keys(agglomerates)) need to be merged
  // with the synaptic partner agglomerate ids. The synaptic partner agglomerate ids can be found by looking at the
  // filtered set of all synapses and picking the src/dst key, depending on whether the partner is pre- or postsynaptic
  // (the other key will usually be undefined). For synapses that occur for both directions it doesn't matter, because that
  // implicates that the associated agglomerated ids both need to be top level agglomerate ids as well.
  const { synapses, agglomerates } = connectomeData;
  const topLevelAgglomerateIds = Object.keys(agglomerates).map(agglomerateId => +agglomerateId);
  const filteredSynapseIds = getSynapseIdsFromConnectomeData(connectomeData);
  const partnerAgglomerateIds = filteredSynapseIds.map(
    (synapseId): number => {
      const synapse = synapses[synapseId];
      // $FlowIssue[incompatible-return] Flow doesn't understand that if src == null -> dst != null
      return synapse.src != null ? synapse.src : synapse.dst;
    },
  );
  return unique(topLevelAgglomerateIds.concat(partnerAgglomerateIds));
};

const getTreeNameForSynapse = (synapseId: number): string => `synapse-${synapseId}`;

const getAgglomerateIdsFromKeys = (keys: Array<string>): Array<number> =>
  // The id identifying the respective agglomerate is at the second position (pattern is segment;xxx;[...])
  unique(keys.map(key => +key.split(";")[1]));

const synapseTreeCreator = (synapseId: number, synapseType: string): MutableTree => ({
  name: getTreeNameForSynapse(synapseId),
  treeId: synapseId,
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  color: map3(el => el / 255, stringToAntdColorPresetRgb(synapseType)),
  branchPoints: [],
  edges: new EdgeCollection(),
  comments: [],
  isVisible: true,
  groupId: null,
});

const synapseNodeCreator = (synapseId: number, synapsePosition: Vector3): MutableNode => ({
  position: synapsePosition,
  radius: Constants.DEFAULT_NODE_RADIUS,
  rotation: [0, 0, 0],
  viewport: 0,
  resolution: 0,
  id: synapseId,
  timestamp: Date.now(),
  bitDepth: 8,
  interpolation: false,
});

function* mapAndFilterTreeData<R>(
  nodes: Array<TreeNode>,
  callback: TreeNode => R,
  condition: TreeNode => boolean = () => true,
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

function ensureTypeToString(synapseTypesAndNames) {
  const { synapseTypes, typeToString } = synapseTypesAndNames;
  if (typeToString.length === 0) {
    Toast.error(`Couldn't read synapseTypes mapping. Please add a json file containing the synapseTypes next to the connectome file.
The format should be: \`{
  "synapse_type_names": [ "type1", "type2", ... ]
}\``);
    // Create mocked synapse type strings
    const largestSynapseTypeId = Math.max(...synapseTypes);
    const mockedTypeToString = [...Array(largestSynapseTypeId + 1).keys()].map(i => `type${i + 1}`);
    return {
      synapseTypes,
      typeToString: mockedTypeToString,
    };
  }
  return synapseTypesAndNames;
}

class ConnectomeView extends React.Component<Props, State> {
  skeletonId: ?number;
  state = {
    connectomeData: null,
    filteredConnectomeData: null,
    availableSynapseTypes: [],
    checkedKeys: [],
    expandedKeys: [],
  };

  componentDidMount() {
    this.initializeSkeleton();
    this.fetchConnections();
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (
      prevProps.activeAgglomerateIds !== this.props.activeAgglomerateIds ||
      prevProps.currentConnectomeFile !== this.props.currentConnectomeFile
    ) {
      this.fetchConnections();
    }
    if (prevProps.segmentationLayer !== this.props.segmentationLayer) {
      this.maybeUpdateSkeleton(prevProps.segmentationLayer);
    }
    if (prevState.filteredConnectomeData !== this.state.filteredConnectomeData) {
      this.updateSynapseTrees(prevState.filteredConnectomeData);
    }
    if (
      prevState.connectomeData !== this.state.connectomeData ||
      prevState.filteredConnectomeData !== this.state.filteredConnectomeData ||
      prevState.checkedKeys !== this.state.checkedKeys
    ) {
      this.updateAgglomerateTrees(
        prevState.connectomeData,
        prevState.filteredConnectomeData,
        prevState.checkedKeys,
      );
    }
  }

  componentWillUnmount() {
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

    this.removeSkeleton(segmentationLayer);
    this.reset();
  }

  reset(segmentationLayer?: ?APISegmentationLayer) {
    if (segmentationLayer == null) {
      segmentationLayer = this.props.segmentationLayer;
    }
    if (segmentationLayer != null) {
      Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentationLayer.name, []));
    }

    this.setState({
      connectomeData: null,
      filteredConnectomeData: null,
      checkedKeys: [],
      expandedKeys: [],
    });
  }

  initializeSkeleton() {
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

    if (this.skeletonId != null) {
      throw new Error(
        "Did not expect skeletonId to exist when initializing a new skeleton. Call removeSkeleton before to properly clean up.",
      );
    }

    Store.dispatch(initializeConnectomeTracingAction(segmentationLayer.name));
    this.skeletonId = getSceneController().addSkeleton(
      state =>
        Maybe.fromNullable(
          state.localSegmentationData[segmentationLayer.name].connectomeData.skeleton,
        ),
      false,
    );
  }

  removeSkeleton(segmentationLayer: APISegmentationLayer) {
    const { skeletonId } = this;
    if (skeletonId != null) {
      Store.dispatch(removeConnectomeTracingAction(segmentationLayer.name));
      getSceneController().removeSkeleton(skeletonId);
      this.skeletonId = null;
    }
  }

  resetSkeleton() {
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

    Store.dispatch(removeConnectomeTracingAction(segmentationLayer.name));
    Store.dispatch(initializeConnectomeTracingAction(segmentationLayer.name));
  }

  maybeUpdateSkeleton(prevSegmentationLayer?: ?APISegmentationLayer) {
    const { segmentationLayer } = this.props;
    if (
      prevSegmentationLayer != null &&
      segmentationLayer != null &&
      prevSegmentationLayer.name === segmentationLayer.name
    ) {
      // Although the segmentation layer object identity changed, it is the same layer. This happens
      // when mapping information is fetched and added to the layer, for example.
      return;
    }

    if (prevSegmentationLayer != null) {
      this.removeSkeleton(prevSegmentationLayer);
      // Reset the state if the segmentation layer is switched
      this.reset(prevSegmentationLayer);
    }

    this.initializeSkeleton();
  }

  async fetchConnections() {
    const { dataset, segmentationLayer, currentConnectomeFile, activeAgglomerateIds } = this.props;

    if (
      currentConnectomeFile == null ||
      segmentationLayer == null ||
      activeAgglomerateIds.length === 0
    )
      return;

    const fetchProperties = [
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
      currentConnectomeFile.connectomeFileName,
    ];
    const synapsesOfAgglomerates = await getSynapsesOfAgglomerates(
      ...fetchProperties,
      activeAgglomerateIds,
    );

    if (synapsesOfAgglomerates.length !== activeAgglomerateIds.length) {
      throw new Error(
        `Requested synapses of ${
          activeAgglomerateIds.length
        } agglomerate(s), but got synapses for ${synapsesOfAgglomerates.length} agglomerate(s).`,
      );
    }

    // Uniquify synapses to avoid requesting data multiple times
    const allInSynapseIds = unique(synapsesOfAgglomerates.flatMap(connections => connections.in));
    const allOutSynapseIds = unique(synapsesOfAgglomerates.flatMap(connections => connections.out));
    const allSynapseIds = unique([...allInSynapseIds, ...allOutSynapseIds]);

    const [
      synapseSources,
      synapseDestinations,
      synapsePositions,
      synapseTypesAndNames,
    ] = await Promise.all([
      getSynapseSources(...fetchProperties, allInSynapseIds),
      getSynapseDestinations(...fetchProperties, allOutSynapseIds),
      getSynapsePositions(...fetchProperties, allSynapseIds),
      getSynapseTypes(...fetchProperties, allSynapseIds),
    ]);
    // TODO: Remove once the backend sends the typeToString mapping from the hdf5 file.
    // Currently, the used jhdf5 library seems to have a bug which makes it impossible to read
    // hdf5 array attributes which is why this information is read from a json file, instead.
    // Since it's easy to forget to create the json file, this code exists to act as a fail-safe.
    const { synapseTypes, typeToString } = ensureTypeToString(synapseTypesAndNames);

    // $FlowIgnore[incompatible-exact] Flow doesn't allow to use exact objects instead of inexact ones.
    // $FlowIgnore[incompatible-call]
    const agglomerates = _.zipObject(activeAgglomerateIds, synapsesOfAgglomerates);
    const synapseIdToSource = _.zipObject(allInSynapseIds, synapseSources);
    const synapseIdToDestination = _.zipObject(allOutSynapseIds, synapseDestinations);
    const synapseIdToPosition = _.zipObject(allSynapseIds, synapsePositions);
    const synapseIdToType = _.zipObject(allSynapseIds, synapseTypes);

    // $FlowIssue[speculation-ambiguous] Flow cannot decide between SrcSynapse | DstSynapse | SrcAndDstSynapse but it doesn't matter
    const synapseObjects = allSynapseIds.map(synapseId => ({
      id: synapseId,
      src: synapseIdToSource[synapseId],
      dst: synapseIdToDestination[synapseId],
      position: synapseIdToPosition[synapseId],
      type: typeToString[synapseIdToType[synapseId]],
    }));
    const synapses = _.zipObject(allSynapseIds, synapseObjects);

    const connectomeData = { agglomerates, synapses, connectomeFile: currentConnectomeFile };

    // Auto-expand all nodes by default. The antd properties like `defaultExpandAll` only work on the first render
    // but not when switching to another agglomerate, afterwards.
    const treeData = convertConnectomeToTreeData(connectomeData) || [];
    const expandedKeys = Array.from(
      mapAndFilterTreeData(treeData, node => node.key, node => node.data.type !== "synapse"),
    );

    // Auto-load the skeletons of the active agglomerates and check all occurences of the same agglomerate
    const topLevelCheckedKeys = treeData.map(topLevelTreeNode => topLevelTreeNode.key);
    const checkedKeys = Array.from(
      mapAndFilterTreeData(
        treeData,
        node => node.key,
        node => topLevelCheckedKeys.some(topLevelKey => node.key.startsWith(topLevelKey)),
      ),
    );

    this.setState({
      connectomeData,
      availableSynapseTypes: typeToString,
      checkedKeys,
      expandedKeys,
    });
  }

  updateSynapseTrees(prevFilteredConnectomeData: ?ConnectomeData) {
    const { segmentationLayer } = this.props;
    const { filteredConnectomeData } = this.state;

    if (segmentationLayer == null) return;

    let prevFilteredSynapseIds: Array<number> = [];
    let filteredSynapseIds: Array<number> = [];
    if (prevFilteredConnectomeData != null) {
      prevFilteredSynapseIds = getSynapseIdsFromConnectomeData(prevFilteredConnectomeData);
    }
    if (filteredConnectomeData != null) {
      filteredSynapseIds = getSynapseIdsFromConnectomeData(filteredConnectomeData);
    }

    const reset =
      prevFilteredConnectomeData != null &&
      filteredConnectomeData != null &&
      prevFilteredConnectomeData.connectomeFile !== filteredConnectomeData.connectomeFile;

    let deletedSynapseIds;
    let addedSynapseIds;
    if (reset) {
      // If the data needs to be reset, because the connectome file has changed, all existing trees need to be removed
      // and all non-existing trees need to be newly added. Otherwise, IDs of one connectome file would get mixed up
      // with IDs from the other.
      deletedSynapseIds = prevFilteredSynapseIds;
      addedSynapseIds = filteredSynapseIds;
    } else {
      // Find out which synapses were deleted and which were added
      ({ onlyA: deletedSynapseIds, onlyB: addedSynapseIds } = diffArrays(
        prevFilteredSynapseIds,
        filteredSynapseIds,
      ));
    }

    const layerName = segmentationLayer.name;
    const skeleton = Store.getState().localSegmentationData[layerName].connectomeData.skeleton;
    if (skeleton == null) return;

    const { trees } = skeleton;

    if (deletedSynapseIds.length > 0) {
      const treeIdsToDelete = [];
      const treeNameToTree = _.keyBy(trees, "name");
      deletedSynapseIds.forEach(synapseId => {
        const tree = treeNameToTree[getTreeNameForSynapse(synapseId)];
        if (tree != null) {
          treeIdsToDelete.push(tree.treeId);
        }
      });

      if (treeIdsToDelete.length) {
        Store.dispatch(deleteConnectomeTreesAction(treeIdsToDelete, layerName));
      }
    }

    if (addedSynapseIds.length > 0 && filteredConnectomeData != null) {
      const { synapses } = filteredConnectomeData;
      const newTrees: MutableTreeMap = {};
      for (const synapseId of addedSynapseIds) {
        newTrees[synapseId] = synapseTreeCreator(synapseId, synapses[synapseId].type);
        const synapseNode = synapseNodeCreator(synapseId, synapses[synapseId].position);
        newTrees[synapseId].nodes.mutableSet(synapseId, synapseNode);
      }

      Store.dispatch(addConnectomeTreesAction(newTrees, layerName));
    }
  }

  updateAgglomerateTrees(
    prevConnectomeData: ?ConnectomeData,
    prevFilteredConnectomeData: ?ConnectomeData,
    prevCheckedKeys: Array<string>,
  ) {
    const { segmentationLayer } = this.props;
    const { connectomeData, filteredConnectomeData, checkedKeys } = this.state;

    if (segmentationLayer == null) return;

    let prevFilteredAgglomerateIds: Array<number> = [];
    let filteredAgglomerateIds: Array<number> = [];
    let prevUnfilteredAgglomerateIds: Array<number> = [];
    let unfilteredAgglomerateIds: Array<number> = [];
    if (prevFilteredConnectomeData != null) {
      prevFilteredAgglomerateIds = getAgglomerateIdsFromConnectomeData(prevFilteredConnectomeData);
    }
    if (filteredConnectomeData != null) {
      filteredAgglomerateIds = getAgglomerateIdsFromConnectomeData(filteredConnectomeData);
    }
    if (prevConnectomeData != null) {
      prevUnfilteredAgglomerateIds = getAgglomerateIdsFromConnectomeData(prevConnectomeData);
    }
    if (connectomeData != null) {
      unfilteredAgglomerateIds = getAgglomerateIdsFromConnectomeData(connectomeData);
    }

    const checkedAgglomerateIds = getAgglomerateIdsFromKeys(checkedKeys);
    const visibleAgglomerateIds = checkedAgglomerateIds.filter(agglomerateId =>
      filteredAgglomerateIds.includes(agglomerateId),
    );

    const reset =
      prevConnectomeData != null &&
      connectomeData != null &&
      prevConnectomeData.connectomeFile.mappingName !== connectomeData.connectomeFile.mappingName;

    let deletedAgglomerateIds;
    let hiddenAgglomerateIds;
    let addedAgglomerateIds;
    if (reset) {
      // If the agglomerate skeletons need to be reset, because the connectome file mapping has changed,
      // all existing trees need to be removed and all non-existing trees need to be newly added.
      // Otherwise, IDs of one connectome file would get mixed up with IDs from the other.
      deletedAgglomerateIds = prevUnfilteredAgglomerateIds;
      hiddenAgglomerateIds = [];
      addedAgglomerateIds = visibleAgglomerateIds;
    } else {
      const prevCheckedAgglomerateIds = getAgglomerateIdsFromKeys(prevCheckedKeys);

      // Find out which agglomerates were deleted
      ({ onlyA: deletedAgglomerateIds } = diffArrays(
        prevUnfilteredAgglomerateIds,
        unfilteredAgglomerateIds,
      ));

      const prevVisibleAgglomerateIds = prevCheckedAgglomerateIds.filter(agglomerateId =>
        prevFilteredAgglomerateIds.includes(agglomerateId),
      );

      // Find out which agglomerates were hidden or added by filtering/checking
      ({ onlyA: hiddenAgglomerateIds, onlyB: addedAgglomerateIds } = diffArrays(
        prevVisibleAgglomerateIds,
        visibleAgglomerateIds,
      ));
    }

    const getMappingNameFromConnectomeDataEnforced = (connectome: ?ConnectomeData) => {
      // This should never be the case, but it's not straightforward for Flow to infer
      if (connectome == null) throw new Error("Connectome data was null.");
      return connectome.connectomeFile.mappingName;
    };

    const layerName = segmentationLayer.name;
    if (deletedAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeDataEnforced(prevConnectomeData);
      for (const agglomerateId of deletedAgglomerateIds) {
        // The check whether these skeleton were actually loaded and need to be removed is done by the saga
        Store.dispatch(
          removeAgglomerateSkeletonAction(layerName, mappingName, agglomerateId, "connectome"),
        );
      }
    }

    const skeleton = Store.getState().localSegmentationData[layerName].connectomeData.skeleton;
    if (skeleton == null) return;

    const { trees } = skeleton;
    const treeNameToTree = _.keyBy(trees, "name");

    if (hiddenAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeDataEnforced(prevConnectomeData);
      for (const agglomerateId of hiddenAgglomerateIds) {
        // Hide agglomerates that are no longer visible
        const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
        const tree = treeNameToTree[treeName];
        if (tree != null) {
          Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], false, layerName));
        }
      }
    }

    if (addedAgglomerateIds.length) {
      const mappingName = getMappingNameFromConnectomeDataEnforced(connectomeData);
      for (const agglomerateId of addedAgglomerateIds) {
        // Show agglomerates that were made visible
        const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
        const tree = treeNameToTree[treeName];

        // If the tree was already loaded, make it visible, otherwise load it
        if (tree != null) {
          Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], true, layerName));
        } else {
          Store.dispatch(
            loadAgglomerateSkeletonAction(layerName, mappingName, agglomerateId, "connectome"),
          );
        }
      }
    }
  }

  onUpdateFilteredConnectomeData = (filteredConnectomeData: ?ConnectomeData) => {
    this.setState({ filteredConnectomeData });
  };

  handleChangeActiveSegment = (evt: SyntheticInputEvent<>) => {
    const agglomerateIds = evt.target.value
      .split(",")
      .map(part => parseInt(part, 10))
      .filter(id => !Number.isNaN(id));

    this.setActiveConnectomeAgglomerateIds(agglomerateIds);

    evt.target.blur();
  };

  setActiveConnectomeAgglomerateIds = (agglomerateIds: Array<number>) => {
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

    Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentationLayer.name, agglomerateIds));
  };

  handleCheck = (
    { checked }: { checked: Array<string> },
    { node, checked: isChecked }: { node: TreeNode, checked: boolean },
  ) => {
    // The trailing ; is important to avoid matching 1234 if the id is 12
    const checkedNodeKeyPrefix = `segment;${node.data.id};`;
    if (isChecked) {
      // Find out which keys should also be checked, because they represent the same agglomerate
      const treeData = convertConnectomeToTreeData(this.state.connectomeData) || [];
      const additionalCheckedKeys = Array.from(
        mapAndFilterTreeData(
          treeData,
          treeNode => treeNode.key,
          treeNode => treeNode.key.startsWith(checkedNodeKeyPrefix),
        ),
      );
      this.setState({ checkedKeys: [...checked, ...additionalCheckedKeys] });
    } else {
      // Find out which keys should also be unchecked, because they represent the same agglomerate
      const checkedKeys = checked.filter(key => !key.startsWith(checkedNodeKeyPrefix));
      this.setState({ checkedKeys });
    }
  };

  handleExpand = (expandedKeys: Array<string>) => {
    this.setState({ expandedKeys });
  };

  isConnectomeMappingActive(): boolean {
    const { mappingInfo, currentConnectomeFile } = this.props;

    if (mappingInfo == null || currentConnectomeFile == null) return true;

    if (
      mappingInfo.mappingName !== currentConnectomeFile.mappingName ||
      mappingInfo.mappingStatus === MappingStatusEnum.DISABLED
    ) {
      return false;
    }
    return true;
  }

  activateConnectomeMapping() {
    const { segmentationLayer, currentConnectomeFile } = this.props;

    if (segmentationLayer == null || currentConnectomeFile == null) return;

    Store.dispatch(
      setMappingAction(segmentationLayer.name, currentConnectomeFile.mappingName, "HDF5", {
        showLoadingIndicator: true,
      }),
    );
  }

  getConnectomeMappingActivationAlert() {
    const isConnectomeMappingActive = this.isConnectomeMappingActive();

    return isConnectomeMappingActive ? null : (
      <Alert
        message={
          <>
            The mapping this connectome was computed for is not active.{" "}
            <a href="#" onClick={() => this.activateConnectomeMapping()}>
              Click to activate.
            </a>
          </>
        }
        type="info"
        showIcon
        style={{ marginBottom: 10 }}
      />
    );
  }

  getConnectomeHeader() {
    const { activeAgglomerateIds, segmentationLayer, currentConnectomeFile } = this.props;
    const { availableSynapseTypes, connectomeData } = this.state;
    const activeAgglomerateIdString = activeAgglomerateIds.length
      ? activeAgglomerateIds.join(",")
      : "";

    const disabled = currentConnectomeFile == null;

    return (
      <>
        <Input.Group compact className="compact-icons" style={{ marginBottom: 10 }}>
          <Tooltip title="Show Synaptic Connections for Segment ID(s)">
            <InputComponent
              value={activeAgglomerateIdString}
              onPressEnter={this.handleChangeActiveSegment}
              placeholder="Enter Segment ID(s)"
              style={{ width: 220 }}
              disabled={disabled}
            />
          </Tooltip>
          <ButtonComponent onClick={() => this.reset()} disabled={disabled}>
            Reset
          </ButtonComponent>
          <ConnectomeFilters
            availableSynapseTypes={availableSynapseTypes}
            connectomeData={connectomeData}
            onUpdateFilteredConnectomeData={this.onUpdateFilteredConnectomeData}
            disabled={disabled}
          />
          <ConnectomeSettings segmentationLayer={segmentationLayer} />
        </Input.Group>
        {this.getConnectomeMappingActivationAlert()}
      </>
    );
  }

  getSynapseTree() {
    const { activeAgglomerateIds, currentConnectomeFile } = this.props;
    const { filteredConnectomeData, checkedKeys, expandedKeys } = this.state;

    if (currentConnectomeFile == null) {
      return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No connectome available." />;
    } else if (activeAgglomerateIds.length === 0 || filteredConnectomeData == null) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No segment selected. Use the input field above to enter segment IDs."
        />
      );
    } else {
      return (
        <SynapseTree
          checkedKeys={checkedKeys}
          expandedKeys={expandedKeys}
          onCheck={this.handleCheck}
          onExpand={this.handleExpand}
          onChangeActiveAgglomerateIds={this.setActiveConnectomeAgglomerateIds}
          connectomeData={filteredConnectomeData}
        />
      );
    }
  }

  render() {
    const { segmentationLayer } = this.props;

    return (
      <div id={connectomeTabId} className="padded-tab-content">
        {segmentationLayer == null ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No segmentation layer visible."
          />
        ) : (
          <>
            {this.getConnectomeHeader()}
            {this.getSynapseTree()}
          </>
        )}
      </div>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(ConnectomeView);
