// @flow
import { Alert, Checkbox, Divider, Empty, Input, Popover, Select, Tooltip } from "antd";
import { FilterOutlined, SettingOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Maybe from "data.maybe";
import React from "react";
import _ from "lodash";

import type { APISegmentationLayer, APIDataset, APIConnectomeFile } from "types/api_flow_types";
import { diffArrays, unique } from "libs/utils";
import { findTreeByName } from "oxalis/model/accessors/skeletontracing_accessor";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import {
  getSynapsesOfAgglomerates,
  getSynapseSources,
  getSynapseDestinations,
  getSynapsePositions,
  getSynapseTypes,
  getConnectomeFilesForDatasetLayer,
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
  updateConnectomeFileListAction,
  updateCurrentConnectomeFileAction,
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
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
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
  type Synapse,
  type Agglomerate,
  type TreeNode,
  convertConnectomeToTreeData,
  directionCaptions,
} from "oxalis/view/right-border-tabs/connectome_tab/synapse_tree";

const connectomeTabId = "connectome-view";

const { Option } = Select;

type ConnectomeFilters = {
  synapseTypes: Array<string>,
  synapseDirections: Array<string>,
};

type StateProps = {|
  dataset: APIDataset,
  // segmentationLayer will be the visible segmentation layer, or if there is none,
  // the segmentation layer that was last visible. This is done to allow toggling
  // the segmentation layer while browsing a connectome.
  segmentationLayer: ?APISegmentationLayer,
  availableConnectomeFiles: ?Array<APIConnectomeFile>,
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
    availableConnectomeFiles:
      connectomeData != null ? connectomeData.availableConnectomeFiles : null,
    currentConnectomeFile: connectomeData != null ? connectomeData.currentConnectomeFile : null,
    activeAgglomerateIds: connectomeData != null ? connectomeData.activeAgglomerateIds : [],
    mappingInfo,
  };
};

type Props = StateProps;

type State = {
  connectomeData: ?ConnectomeData,
  filteredConnectomeData: ?ConnectomeData,
  synapseTypes: Array<string>,
  filters: ConnectomeFilters,
  checkedKeys: Array<string>,
  expandedKeys: Array<string>,
};

const getFilteredConnectomeData = (
  connectomeData: ?ConnectomeData,
  filters: ?ConnectomeFilters,
  numSynapseTypes: number,
): ?ConnectomeData => {
  if (connectomeData == null || filters == null) return connectomeData;

  const { synapseTypes, synapseDirections } = filters;

  if (synapseTypes.length === numSynapseTypes && synapseDirections.length === 2) {
    return connectomeData;
  }

  const { agglomerates, synapses } = connectomeData;

  const filteredAgglomerates = _.mapValues(agglomerates, agglomerate =>
    _.pick(agglomerate, synapseDirections),
  );
  const filteredSynapses = _.pickBy(synapses, (synapse: Synapse) =>
    synapseTypes.includes(synapse.type),
  );

  return { agglomerates: filteredAgglomerates, synapses: filteredSynapses };
};

const getSynapseIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> => {
  const { synapses, agglomerates } = connectomeData;
  return unique(
    Object.values(agglomerates).flatMap(
      // $FlowIssue[incompatible-call] remove once https://github.com/facebook/flow/issues/2221 is fixed
      ({ in: inSynapses = [], out: outSynapses = [] }: Agglomerate) => [
        ...inSynapses,
        ...outSynapses,
      ],
    ),
  ).filter(synapseId => synapses[synapseId]);
};

const getAgglomerateIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> => {
  const { synapses, agglomerates } = connectomeData;
  return unique(
    _.flatten([
      ...Object.keys(agglomerates).map(agglomerateId => +agglomerateId),
      // $FlowIssue[incompatible-call] remove once https://github.com/facebook/flow/issues/2221 is fixed
      ...Object.values(synapses).map((synapse: Synapse) =>
        // $FlowIssue[incompatible-call] Flow doesn't understand that if src == null -> dst != null
        synapse.src != null ? synapse.src : synapse.dst,
      ),
    ]),
  );
};

const getTreeNameForAgglomerateSkeleton = (agglomerateId: number, mappingName: string): string =>
  `agglomerate ${agglomerateId} (${mappingName})`;

const getTreeNameForSynapse = (synapseId: number): string => `synapse-${synapseId}`;

const getAgglomerateIdsFromKeys = (keys: Array<string>): Array<number> =>
  keys
    .map(key => {
      const parts = key.split("-");
      // The id identifying the respective agglomerate is at the very end if at all
      const lastPart = parts[parts.length - 1];
      // $FlowIssue[incompatible-return] For some reason flow ignores that the null values are filtered out, later
      return isNaN(lastPart) ? null : +lastPart;
    })
    .filter(val => val != null);

const synapseTreeCreator = (synapseId: number, synapseType: string): MutableTree => ({
  name: getTreeNameForSynapse(synapseId),
  treeId: synapseId,
  nodes: new DiffableMap(),
  timestamp: Date.now(),
  // $FlowIssue[invalid-tuple-arity] Flow has troubles with understanding that mapping a tuple, returns another tuple
  color: stringToAntdColorPresetRgb(synapseType).map(el => el / 255),
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

function* mapTreeData<R>(
  nodes: Array<TreeNode>,
  callback: TreeNode => R,
): Generator<R, void, void> {
  for (const node of nodes) {
    yield callback(node);
    if (node.children) {
      yield* mapTreeData(node.children, callback);
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

const defaultFilters = {
  synapseTypes: [],
  synapseDirections: ["in", "out"],
};

class ConnectomeView extends React.Component<Props, State> {
  skeletonId: ?number;
  state = {
    connectomeData: null,
    filteredConnectomeData: null,
    synapseTypes: [],
    filters: defaultFilters,
    checkedKeys: [],
    expandedKeys: [],
  };

  componentDidMount() {
    this.maybeFetchConnectomeFiles();
    this.initializeSkeleton();
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (
      prevProps.activeAgglomerateIds !== this.props.activeAgglomerateIds ||
      prevProps.currentConnectomeFile !== this.props.currentConnectomeFile
    ) {
      this.fetchConnections(prevState.synapseTypes);
    }
    if (prevProps.segmentationLayer !== this.props.segmentationLayer) {
      this.maybeFetchConnectomeFiles();
      this.maybeUpdateSkeleton(prevProps.segmentationLayer);
    }
    if (
      prevState.connectomeData !== this.state.connectomeData ||
      prevState.filters !== this.state.filters
    ) {
      this.updateFilteredConnectomeData();
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

  resetFilters = () => {
    this.setState(prevState => ({
      filters: { ...defaultFilters, synapseTypes: prevState.synapseTypes },
    }));
  };

  initializeSkeleton() {
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

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

  async maybeFetchConnectomeFiles() {
    const {
      dataset,
      segmentationLayer,
      availableConnectomeFiles,
      currentConnectomeFile,
    } = this.props;

    // If availableConnectomeFiles is not null, they have already been fetched
    if (segmentationLayer == null || availableConnectomeFiles != null) return;

    const connectomeFiles = await getConnectomeFilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
    );

    const layerName = segmentationLayer.name;

    Store.dispatch(updateConnectomeFileListAction(layerName, connectomeFiles));
    if (currentConnectomeFile == null && connectomeFiles.length > 0) {
      Store.dispatch(
        updateCurrentConnectomeFileAction(layerName, connectomeFiles[0].connectomeFileName),
      );
    }
  }

  isConnectomeMappingActive(): boolean {
    const { mappingInfo, currentConnectomeFile } = this.props;

    if (mappingInfo == null || currentConnectomeFile == null) return false;

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

  async fetchConnections(prevSynapseTypes?: Array<string> = []) {
    const { filters } = this.state;
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
    // TODO: Remove once the backend sends the typeToString mapping from the hdf5 file
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

    const connectomeData = { agglomerates, synapses };

    // Remove filters for synapse types that are no longer valid
    const validOldSynapseTypes = filters.synapseTypes.filter(synapseType =>
      typeToString.includes(synapseType),
    );
    // Add positive filters for synapse types that are new
    const newlyAddedSynapseTypes = typeToString.filter(
      synapseType => !prevSynapseTypes.includes(synapseType),
    );
    const newFilters = {
      ...filters,
      synapseTypes: [...validOldSynapseTypes, ...newlyAddedSynapseTypes],
    };

    // Auto-expand all nodes by default. The antd properties like `defaultExpandAll` only work on the first render
    // but not when switching to another agglomerate, afterwards.
    const treeData = convertConnectomeToTreeData(connectomeData) || [];
    const allKeys = Array.from(mapTreeData(treeData, node => node.key));

    // Auto-load the skeletons of the active agglomerates
    const checkedKeys = treeData.map(topLevelTreeNode => topLevelTreeNode.key);

    this.setState({
      connectomeData,
      synapseTypes: typeToString,
      filters: newFilters,
      checkedKeys,
      expandedKeys: allKeys,
    });
  }

  updateFilteredConnectomeData() {
    const { connectomeData, filters, synapseTypes } = this.state;
    const filteredConnectomeData = getFilteredConnectomeData(
      connectomeData,
      filters,
      synapseTypes.length,
    );
    this.setState({ filteredConnectomeData });
  }

  updateSynapseTrees(prevFilteredConnectomeData: ?ConnectomeData) {
    const { segmentationLayer } = this.props;
    const { filteredConnectomeData, connectomeData } = this.state;

    if (segmentationLayer == null) return;

    let prevFilteredSynapseIds: Array<number> = [];
    let filteredSynapseIds: Array<number> = [];
    let unfilteredSynapseIds: Array<number> = [];
    if (prevFilteredConnectomeData != null) {
      prevFilteredSynapseIds = getSynapseIdsFromConnectomeData(prevFilteredConnectomeData);
    }
    if (filteredConnectomeData != null) {
      filteredSynapseIds = getSynapseIdsFromConnectomeData(filteredConnectomeData);
    }
    if (connectomeData != null) {
      unfilteredSynapseIds = getSynapseIdsFromConnectomeData(connectomeData);
    }

    const layerName = segmentationLayer.name;
    // Find out which synapses were deleted and which were added
    const { onlyA: deletedSynapseIds, onlyB: addedSynapseIds } = diffArrays(
      prevFilteredSynapseIds,
      filteredSynapseIds,
    );

    const skeleton = Store.getState().localSegmentationData[layerName].connectomeData.skeleton;
    if (skeleton == null) return;

    const { trees } = skeleton;

    if (deletedSynapseIds.length) {
      const treeIdsToHide = [];
      const treeIdsToDelete = [];
      deletedSynapseIds.forEach(synapseId =>
        findTreeByName(trees, getTreeNameForSynapse(synapseId)).map(tree =>
          // Delete synapse tree if it is no longer part of the unfiltered data
          // and only hide it otherwise
          unfilteredSynapseIds.includes(synapseId)
            ? treeIdsToHide.push(tree.treeId)
            : treeIdsToDelete.push(tree.treeId),
        ),
      );
      if (treeIdsToHide.length) {
        Store.dispatch(setConnectomeTreesVisibilityAction(treeIdsToHide, false, layerName));
      }
      if (treeIdsToDelete.length) {
        Store.dispatch(deleteConnectomeTreesAction(treeIdsToDelete, layerName));
      }
    }

    if (addedSynapseIds.length > 0 && filteredConnectomeData != null) {
      const { synapses } = filteredConnectomeData;
      const newTrees: MutableTreeMap = {};
      const treeIdsToShow = [];
      for (const synapseId of addedSynapseIds) {
        const maybeTree = findTreeByName(trees, getTreeNameForSynapse(synapseId));
        // If the tree was already created, make it visible, otherwise created it
        maybeTree.cata({
          Just: tree => treeIdsToShow.push(tree.treeId),
          Nothing: () => {
            newTrees[synapseId] = synapseTreeCreator(synapseId, synapses[synapseId].type);
            const synapseNode = synapseNodeCreator(synapseId, synapses[synapseId].position);
            newTrees[synapseId].nodes.mutableSet(synapseId, synapseNode);
          },
        });
      }

      if (treeIdsToShow.length) {
        Store.dispatch(setConnectomeTreesVisibilityAction(treeIdsToShow, true, layerName));
      }
      if (_.size(newTrees)) {
        Store.dispatch(addConnectomeTreesAction(newTrees, layerName));
      }
    }
  }

  updateAgglomerateTrees(
    prevConnectomeData: ?ConnectomeData,
    prevFilteredConnectomeData: ?ConnectomeData,
    prevCheckedKeys: Array<string>,
  ) {
    const { segmentationLayer, currentConnectomeFile } = this.props;
    const { connectomeData, filteredConnectomeData, checkedKeys } = this.state;

    if (segmentationLayer == null || currentConnectomeFile == null) return;

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
    const prevCheckedAgglomerateIds = getAgglomerateIdsFromKeys(prevCheckedKeys);

    const layerName = segmentationLayer.name;
    // Find out which agglomerates were deleted
    const { onlyA: deletedAgglomerateIds } = diffArrays(
      prevUnfilteredAgglomerateIds,
      unfilteredAgglomerateIds,
    );

    const prevVisibleAgglomerateIds = prevCheckedAgglomerateIds.filter(agglomerateId =>
      prevFilteredAgglomerateIds.includes(agglomerateId),
    );
    const visibleAgglomerateIds = checkedAgglomerateIds.filter(agglomerateId =>
      filteredAgglomerateIds.includes(agglomerateId),
    );

    // Find out which agglomerates were hidden or added by filtering/checking
    const { onlyA: hiddenAgglomerateIds, onlyB: addedAgglomerateIds } = diffArrays(
      prevVisibleAgglomerateIds,
      visibleAgglomerateIds,
    );

    const { mappingName } = currentConnectomeFile;

    if (deletedAgglomerateIds.length) {
      for (const agglomerateId of deletedAgglomerateIds) {
        Store.dispatch(
          removeAgglomerateSkeletonAction(layerName, mappingName, agglomerateId, "connectome"),
        );
      }
    }

    const skeleton = Store.getState().localSegmentationData[layerName].connectomeData.skeleton;
    if (skeleton == null) return;

    const { trees } = skeleton;

    if (hiddenAgglomerateIds.length) {
      for (const agglomerateId of hiddenAgglomerateIds) {
        // Hide agglomerates that are no longer visible
        const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
        findTreeByName(trees, treeName).map(tree =>
          Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], false, layerName)),
        );
      }
    }

    if (addedAgglomerateIds.length) {
      for (const agglomerateId of addedAgglomerateIds) {
        // Show agglomerates that were made visible
        const treeName = getTreeNameForAgglomerateSkeleton(agglomerateId, mappingName);
        const maybeTree = findTreeByName(trees, treeName);

        // If the tree was already loaded, make it visible, otherwise load it
        maybeTree.cata({
          Just: tree =>
            Store.dispatch(setConnectomeTreesVisibilityAction([tree.treeId], true, layerName)),
          Nothing: () =>
            Store.dispatch(
              loadAgglomerateSkeletonAction(layerName, mappingName, agglomerateId, "connectome"),
            ),
        });
      }
    }
  }

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

  handleConnectomeFileSelected = async (connectomeFileName: ?string) => {
    const { segmentationLayer } = this.props;
    if (segmentationLayer != null && connectomeFileName != null) {
      Store.dispatch(updateCurrentConnectomeFileAction(segmentationLayer.name, connectomeFileName));
    }
  };

  handleCheck = ({ checked }: { checked: Array<string> }) => {
    this.setState({ checkedKeys: checked });
  };

  handleExpand = (expandedKeys: Array<string>) => {
    this.setState({ expandedKeys });
  };

  onChangeSynapseDirectionFilter = (synapseDirections: Array<string>) => {
    this.setState(oldState => ({
      filters: {
        ...oldState.filters,
        synapseDirections,
      },
    }));
  };

  onChangeSynapseTypeFilter = (synapseTypes: Array<string>) => {
    this.setState(oldState => ({
      filters: {
        ...oldState.filters,
        synapseTypes,
      },
    }));
  };

  getFilterSettings = () => {
    const { synapseTypes, filters } = this.state;

    const synapseDirectionOptions = Object.keys(directionCaptions).map(direction => ({
      label: directionCaptions[direction],
      value: direction,
    }));
    const synapseTypeOptions = synapseTypes.map(synapseType => ({
      label: synapseType,
      value: synapseType,
    }));

    return (
      <div>
        <h4 style={{ display: "inline-block" }}>Filters</h4>
        <ButtonComponent style={{ float: "right" }} onClick={this.resetFilters}>
          Reset
        </ButtonComponent>
        <Divider style={{ margin: "10px 0" }} />
        <h4>by Synapse Direction</h4>
        <Checkbox.Group
          options={synapseDirectionOptions}
          value={filters.synapseDirections}
          onChange={this.onChangeSynapseDirectionFilter}
        />
        <h4>by Synapse Type</h4>
        <Checkbox.Group
          options={synapseTypeOptions}
          value={filters.synapseTypes}
          onChange={this.onChangeSynapseTypeFilter}
        />
      </div>
    );
  };

  getConnectomeFileSettings = () => {
    const { currentConnectomeFile, availableConnectomeFiles } = this.props;
    const currentConnectomeFileName =
      currentConnectomeFile != null ? currentConnectomeFile.connectomeFileName : null;
    return (
      <Tooltip title="Select a connectome file from which synapses will be loaded.">
        <Select
          style={{ width: 250 }}
          placeholder="Select a connectome file"
          value={currentConnectomeFileName}
          onChange={this.handleConnectomeFileSelected}
          size="small"
          loading={availableConnectomeFiles == null}
        >
          {availableConnectomeFiles ? (
            availableConnectomeFiles.map(connectomeFile => (
              <Option
                key={connectomeFile.connectomeFileName}
                value={connectomeFile.connectomeFileName}
              >
                {connectomeFile.connectomeFileName}
              </Option>
            ))
          ) : (
            <Option value={null} disabled>
              No files available.
            </Option>
          )}
        </Select>
      </Tooltip>
    );
  };

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
    const { filters, synapseTypes } = this.state;
    const { activeAgglomerateIds } = this.props;
    const activeAgglomerateIdString = activeAgglomerateIds.length
      ? activeAgglomerateIds.join(",")
      : "";

    const isSynapseTypeFilterAvailable = synapseTypes.length;

    const isSynapseTypeFiltered = filters.synapseTypes.length !== synapseTypes.length;
    const isSynapseDirectionFiltered = filters.synapseDirections.length !== 2;
    const isAnyFilterActive = isSynapseTypeFiltered || isSynapseDirectionFiltered;

    return (
      <>
        <Input.Group compact className="compact-icons" style={{ marginBottom: 10 }}>
          <Tooltip title="Show Synaptic Connections for Segment ID(s)">
            <InputComponent
              value={activeAgglomerateIdString}
              onPressEnter={this.handleChangeActiveSegment}
              placeholder="Segment ID 1[, Segment ID 2, ...]"
              style={{ width: 220 }}
            />
          </Tooltip>
          <ButtonComponent onClick={() => this.reset()}>Reset</ButtonComponent>
          <Tooltip title="Configure Filters">
            <Popover content={this.getFilterSettings} trigger="click" placement="bottom">
              <ButtonComponent disabled={!isSynapseTypeFilterAvailable}>
                <FilterOutlined style={isAnyFilterActive ? { color: "red" } : {}} />
              </ButtonComponent>
            </Popover>
          </Tooltip>
          <Tooltip title="Configure Connectome File Settings" placement="left">
            <Popover content={this.getConnectomeFileSettings} trigger="click" placement="bottom">
              <ButtonComponent>
                <SettingOutlined />
              </ButtonComponent>
            </Popover>
          </Tooltip>
        </Input.Group>
        {this.getConnectomeMappingActivationAlert()}
      </>
    );
  }

  render() {
    const { segmentationLayer, availableConnectomeFiles, activeAgglomerateIds } = this.props;
    const { filteredConnectomeData, checkedKeys, expandedKeys } = this.state;

    return (
      <div id={connectomeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={connectomeTabId}>
          {(_isVisibleInDom, wasEverVisibleInDom) => {
            // Render the tab in the background to avoid rebuilding the tree when switching tabs. The rebuild
            // often times is rather performance intensive and the scroll position is lost as well.
            // However, only render it after the tab was visible for the first time (lazy-loading).
            if (!wasEverVisibleInDom) return null;

            if (!segmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            if (availableConnectomeFiles == null || availableConnectomeFiles.length === 0) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No connectome available."
                />
              );
            }

            return (
              <>
                {this.getConnectomeHeader()}
                {activeAgglomerateIds.length === 0 || filteredConnectomeData == null ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No segment selected. Use the input field above to enter a segment ID."
                  />
                ) : (
                  <SynapseTree
                    checkedKeys={checkedKeys}
                    expandedKeys={expandedKeys}
                    onCheck={this.handleCheck}
                    onExpand={this.handleExpand}
                    onChangeActiveAgglomerateIds={this.setActiveConnectomeAgglomerateIds}
                    connectomeData={filteredConnectomeData}
                  />
                )}
              </>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(mapStateToProps)(ConnectomeView);
