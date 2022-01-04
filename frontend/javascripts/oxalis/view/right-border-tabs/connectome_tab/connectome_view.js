// @flow
import { AutoSizer } from "react-virtualized";
import { Checkbox, Divider, Empty, Input, Popover, Select, Tag, Tooltip, Tree } from "antd";
import type { Dispatch } from "redux";
import { FilterOutlined, SettingOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Maybe from "data.maybe";
import React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";

import type { APISegmentationLayer, APIDataset, APIConnectomeFile } from "types/api_flow_types";
import type { ExtractReturn } from "libs/type_helpers";
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
import { stringToAntdColorPreset, stringToAntdColorPresetRgb } from "libs/format_utils";
import {
  updateDatasetSettingAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
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
} from "oxalis/store";
import Toast from "libs/toast";
import api from "oxalis/api/internal_api";
import getSceneController from "oxalis/controller/scene_controller_provider";

const connectomeTabId = "connectome";

const { Option } = Select;

type Synapse = { id: number, position: Vector3, type: string };
type SynapticPartners = { [number]: Array<Synapse> };
type Connections = { in?: SynapticPartners, out?: SynapticPartners };
type ConnectomeData = { [number]: Connections };

type ConnectomeFilters = {
  synapseTypes: Array<string>,
  synapseDirections: Array<string>,
};

type SegmentData = { type: "segment", id: number };
type SynapseData = { type: "synapse", id: number, position: Vector3, synapseType: string };
type NoneData = { type: "none" };
type TreeNodeData = SegmentData | SynapseData | NoneData;
type TreeNode = {
  key: string,
  title: string,
  children: Array<TreeNode>,
  disabled?: boolean,
  selectable?: boolean,
  checkable?: boolean,
  data: TreeNodeData,
};
type TreeData = Array<TreeNode>;

type StateProps = {|
  dataset: APIDataset,
  // segmentationLayer will be the visible segmentation layer, or if there is none,
  // the segmentation layer that was last visible. This is done to allow toggling
  // the segmentation layer while browsing a connectome.
  segmentationLayer: ?APISegmentationLayer,
  availableConnectomeFiles: ?Array<APIConnectomeFile>,
  currentConnectomeFile: ?APIConnectomeFile,
  activeAgglomerateIds: Array<number>,
|};

const mapStateToProps = (state: OxalisState): StateProps => {
  const segmentationLayer = getVisibleOrLastSegmentationLayer(state);
  const connectomeData =
    segmentationLayer != null
      ? state.localSegmentationData[segmentationLayer.name].connectomeData
      : null;
  return {
    dataset: state.dataset,
    segmentationLayer,
    availableConnectomeFiles:
      connectomeData != null ? connectomeData.availableConnectomeFiles : null,
    currentConnectomeFile: connectomeData != null ? connectomeData.currentConnectomeFile : null,
    activeAgglomerateIds: connectomeData != null ? connectomeData.activeAgglomerateIds : [],
  };
};

const mapDispatchToProps = (dispatch: Dispatch<*>): * => ({
  onChangeDatasetSettings(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
});

type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = {| ...DispatchProps, ...StateProps |};

type State = {
  connectomeData: ?ConnectomeData,
  filteredConnectomeData: ?ConnectomeData,
  synapseTypes: Array<string>,
  filters: ConnectomeFilters,
  checkedKeys: Array<string>,
  expandedKeys: Array<string>,
};

const directionCaptions = { in: "Incoming", out: "Outgoing" };

const segmentData = (segmentId: number): SegmentData => ({
  type: "segment",
  id: segmentId,
});
const synapseData = (synapseId: number, position: Vector3, type: string): SynapseData => ({
  type: "synapse",
  id: synapseId,
  position,
  synapseType: type,
});
const noneData = { type: "none" };

const _convertConnectomeToTreeData = (connectomeData: ?ConnectomeData): ?TreeData => {
  if (connectomeData == null) return null;

  const convertSynapsesForPartner = (partners, partnerId1, direction): Array<TreeNode> => {
    if (partners == null) return [];

    return Object.keys(partners).map(partnerId2 => ({
      key: `segment-${partnerId1}-${direction}-${partnerId2}`,
      title: `Segment ${partnerId2}`,
      data: segmentData(+partnerId2),
      children: partners[+partnerId2].map(synapse => ({
        key: `synapse-${direction}-${synapse.id}`,
        title: `Synapse ${synapse.id}`,
        data: synapseData(synapse.id, synapse.position, synapse.type),
        children: [],
        checkable: false,
      })),
    }));
  };

  return Object.keys(connectomeData).map(partnerId1 => ({
    key: `segment-${partnerId1}`,
    title: `Segment ${partnerId1}`,
    data: segmentData(+partnerId1),
    children: Object.keys(connectomeData[+partnerId1]).map(direction => ({
      key: `segment-${partnerId1}-${direction}`,
      title: `${directionCaptions[direction]} Synapses`,
      data: noneData,
      children: convertSynapsesForPartner(
        connectomeData[+partnerId1][direction],
        partnerId1,
        direction,
      ),
      checkable: false,
      selectable: false,
    })),
  }));
};

function filterKeysWithEmptyArray(obj) {
  return _.omitBy(obj, value => value.length === 0);
}

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

  return _.mapValues(connectomeData, connections =>
    _.pick(
      _.mapValues(connections, (partners, direction) =>
        synapseDirections.includes(direction)
          ? filterKeysWithEmptyArray(
              _.mapValues(partners, synapses =>
                synapses.filter(synapse => synapseTypes.includes(synapse.type)),
              ),
            )
          : {},
      ),
      synapseDirections,
    ),
  );
};

const getSynapsesFromConnectomeData = (connectomeData: ConnectomeData): Array<Synapse> =>
  _.flatten(
    // $FlowIssue[incompatible-call] remove once https://github.com/facebook/flow/issues/2221 is fixed
    Object.values(connectomeData).map((connections: Connections) => [
      ..._.flatten(Object.values(connections.in || {})),
      ..._.flatten(Object.values(connections.out || {})),
    ]),
  );

const getAgglomerateIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> =>
  _.flatten(
    Object.keys(connectomeData).map(partnerId1 => [
      +partnerId1,
      ...Object.keys(connectomeData[+partnerId1].in || {}).map(idString => +idString),
      ...Object.keys(connectomeData[+partnerId1].out || {}).map(idString => +idString),
    ]),
  );

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

const convertConnectomeToTreeData = memoizeOne(_convertConnectomeToTreeData);

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
      prevProps.currentConnectomeFile !== this.props.currentConnectomeFile ||
      prevProps.segmentationLayer !== this.props.segmentationLayer
    ) {
      this.activateConnectomeMapping();
    }
    if (
      prevProps.activeAgglomerateIds !== this.props.activeAgglomerateIds ||
      prevProps.currentConnectomeFile !== this.props.currentConnectomeFile
    ) {
      this.fetchConnections(prevState.synapseTypes);
    }
    if (prevProps.segmentationLayer !== this.props.segmentationLayer) {
      this.maybeFetchConnectomeFiles();
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

  componentWillUnmount() {}

  reset = () => {
    const { segmentationLayer } = this.props;
    if (segmentationLayer != null) {
      Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentationLayer.name, []));
    }

    this.setState({
      connectomeData: null,
      filteredConnectomeData: null,
      checkedKeys: [],
      expandedKeys: [],
    });
  };

  resetFilters = () => {
    this.setState(prevState => ({
      filters: { ...defaultFilters, synapseTypes: prevState.synapseTypes },
    }));
  };

  initializeSkeleton() {
    const { segmentationLayer } = this.props;
    // TODO: Make sure this works even when switching segmentation layers
    if (segmentationLayer == null) return;

    Store.dispatch(initializeConnectomeTracingAction(segmentationLayer.name));

    getSceneController().addSkeleton(
      state =>
        Maybe.fromNullable(
          state.localSegmentationData[segmentationLayer.name].connectomeData.skeleton,
        ),
      false,
    );
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

  activateConnectomeMapping() {
    const { segmentationLayer, currentConnectomeFile } = this.props;

    if (segmentationLayer == null || currentConnectomeFile == null) return;

    const mappingInfo = getMappingInfo(
      Store.getState().temporaryConfiguration.activeMappingByLayer,
      segmentationLayer.name,
    );

    if (
      mappingInfo.mappingName !== currentConnectomeFile.mappingName ||
      mappingInfo.mappingStatus === MappingStatusEnum.DISABLED
    )
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

    // TODO: Check which activeAgglomerateIds were removed and added
    // to avoid requesting data that is already present

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
    const allInSynapses = unique(
      _.flatten(synapsesOfAgglomerates.map(connections => connections.in)),
    );
    const allOutSynapses = unique(
      _.flatten(synapsesOfAgglomerates.map(connections => connections.out)),
    );
    const allSynapses = unique([...allInSynapses, ...allOutSynapses]);

    const [
      synapseSources,
      synapseDestinations,
      synapsePositions,
      synapseTypesAndNames,
    ] = await Promise.all([
      getSynapseSources(...fetchProperties, allInSynapses),
      getSynapseDestinations(...fetchProperties, allOutSynapses),
      getSynapsePositions(...fetchProperties, allSynapses),
      getSynapseTypes(...fetchProperties, allSynapses),
    ]);
    // TODO: Remove once the backend sends the typeToString mapping from the hdf5 file
    const { synapseTypes, typeToString } = ensureTypeToString(synapseTypesAndNames);

    const synapseIdToSource = _.zipObject(allInSynapses, synapseSources);
    const synapseIdToDestination = _.zipObject(allOutSynapses, synapseDestinations);
    const synapseIdToPosition = _.zipObject(allSynapses, synapsePositions);
    const synapseIdToType = _.zipObject(allSynapses, synapseTypes);

    const connectomeData = {};
    activeAgglomerateIds.forEach((agglomerateId, i) => {
      connectomeData[agglomerateId] = { in: {}, out: {} };

      const inSynapses = synapsesOfAgglomerates[i].in;
      const outSynapses = synapsesOfAgglomerates[i].out;

      inSynapses.forEach(synapseId => {
        const synapticPartnerId = synapseIdToSource[synapseId];
        if (!(synapticPartnerId in connectomeData[agglomerateId].in)) {
          connectomeData[agglomerateId].in[synapticPartnerId] = [];
        }
        connectomeData[agglomerateId].in[synapticPartnerId].push({
          id: synapseId,
          position: synapseIdToPosition[synapseId],
          type: typeToString[synapseIdToType[synapseId]],
        });
      });
      outSynapses.forEach(synapseId => {
        const synapticPartnerId = synapseIdToDestination[synapseId];
        if (!(synapticPartnerId in connectomeData[agglomerateId].out)) {
          connectomeData[agglomerateId].out[synapticPartnerId] = [];
        }
        connectomeData[agglomerateId].out[synapticPartnerId].push({
          id: synapseId,
          position: synapseIdToPosition[synapseId],
          type: typeToString[synapseIdToType[synapseId]],
        });
      });
    });

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

    let prevFilteredSynapses: Array<Synapse> = [];
    let filteredSynapses: Array<Synapse> = [];
    let unfilteredSynapseIds: Array<number> = [];
    if (prevFilteredConnectomeData != null) {
      prevFilteredSynapses = getSynapsesFromConnectomeData(prevFilteredConnectomeData);
    }
    if (filteredConnectomeData != null) {
      filteredSynapses = getSynapsesFromConnectomeData(filteredConnectomeData);
    }
    if (connectomeData != null) {
      unfilteredSynapseIds = getSynapsesFromConnectomeData(connectomeData).map(
        synapse => synapse.id,
      );
    }

    const layerName = segmentationLayer.name;
    // Find out which synapses were deleted and which were added
    const { onlyA: deletedSynapseIds, onlyB: addedSynapseIds } = diffArrays(
      prevFilteredSynapses.map(synapse => synapse.id),
      filteredSynapses.map(synapse => synapse.id),
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

    if (addedSynapseIds.length) {
      const synapseIdToSynapse = _.keyBy(filteredSynapses, "id");
      const newTrees: MutableTreeMap = {};
      const treeIdsToShow = [];
      for (const synapseId of addedSynapseIds) {
        const maybeTree = findTreeByName(trees, getTreeNameForSynapse(synapseId));
        // If the tree was already created, make it visible, otherwise created it
        maybeTree.cata({
          Just: tree => treeIdsToShow.push(tree.treeId),
          Nothing: () => {
            newTrees[synapseId] = synapseTreeCreator(synapseId, synapseIdToSynapse[synapseId].type);
            const synapseNode = synapseNodeCreator(
              synapseId,
              synapseIdToSynapse[synapseId].position,
            );
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
    const { segmentationLayer } = this.props;
    if (segmentationLayer == null) return;

    const agglomerateIds = evt.target.value
      .split(",")
      .map(part => parseInt(part, 10))
      .filter(id => !Number.isNaN(id));

    Store.dispatch(setActiveConnectomeAgglomerateIdsAction(segmentationLayer.name, agglomerateIds));

    evt.target.blur();
  };

  handleConnectomeFileSelected = async (connectomeFileName: ?string) => {
    const { segmentationLayer } = this.props;
    if (segmentationLayer != null && connectomeFileName != null) {
      Store.dispatch(updateCurrentConnectomeFileAction(segmentationLayer.name, connectomeFileName));
    }
  };

  handleSelect = (
    selectedKeys: Array<string>,
    evt: { selected: boolean, selectedNodes: Array<TreeNode>, node: TreeNode, event: string },
  ) => {
    const { data } = evt.node;
    if (data.type === "synapse" && evt.selected) {
      api.tracing.setCameraPosition(data.position);
    }
  };

  handleCheck = ({ checked }: { checked: Array<string> }) => {
    this.setState({ checkedKeys: checked });
  };

  handleExpand = (expandedKeys: Array<string>) => {
    this.setState({ expandedKeys });
  };

  renderNode(node: TreeNode) {
    const { data } = node;
    if (data.type === "segment" || data.type === "none") return node.title;

    return (
      <>
        {node.title}
        <Tag
          style={{ marginLeft: 10, marginBottom: 0 }}
          color={stringToAntdColorPreset(data.synapseType)}
        >
          {data.synapseType}
        </Tag>
      </>
    );
  }

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
      <Input.Group compact className="compact-icons">
        <Tooltip title="Show Synaptic Connections for Segment ID(s)">
          <InputComponent
            value={activeAgglomerateIdString}
            onPressEnter={this.handleChangeActiveSegment}
            placeholder="Segment ID 1[, Segment ID 2, ...]"
            style={{ width: 220 }}
          />
        </Tooltip>
        <ButtonComponent onClick={this.reset}>Reset</ButtonComponent>
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
    );
  }

  render() {
    const { segmentationLayer, availableConnectomeFiles, activeAgglomerateIds } = this.props;
    const { filteredConnectomeData, checkedKeys, expandedKeys } = this.state;

    return (
      <div id={connectomeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={connectomeTabId}>
          {_isVisibleInDom => {
            // if (!isVisibleInDom) return null;

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
                {activeAgglomerateIds.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No segment selected. Use the input field above to enter a segment ID."
                  />
                ) : null}
                {filteredConnectomeData != null ? (
                  <div style={{ flex: "1 1 auto" }}>
                    <AutoSizer>
                      {({ height, width }) => (
                        <div style={{ height, width }}>
                          <Tree
                            checkable
                            checkStrictly
                            defaultExpandAll
                            height={height}
                            showLine={{ showLeafIcon: false }}
                            onSelect={this.handleSelect}
                            onCheck={this.handleCheck}
                            onExpand={this.handleExpand}
                            checkedKeys={checkedKeys}
                            expandedKeys={expandedKeys}
                            titleRender={this.renderNode}
                            treeData={convertConnectomeToTreeData(filteredConnectomeData)}
                          />
                        </div>
                      )}
                    </AutoSizer>
                  </div>
                ) : null}
              </>
            );
          }}
        </DomVisibilityObserver>
      </div>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(ConnectomeView);
