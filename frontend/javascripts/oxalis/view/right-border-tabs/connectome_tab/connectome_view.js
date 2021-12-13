// @flow
import { Tag, Empty, Tree, Tooltip, Popover, Checkbox, Divider, Input } from "antd";
import { FilterOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { batchActions } from "redux-batched-actions";
import { connect } from "react-redux";
import React from "react";
import { AutoSizer } from "react-virtualized";
import _ from "lodash";
import memoizeOne from "memoize-one";
import Maybe from "data.maybe";

import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import type { ExtractReturn } from "libs/type_helpers";

import type { APISegmentationLayer, APIDataset, APIConnectomeFile } from "types/api_flow_types";
import InputComponent from "oxalis/view/components/input_component";
import ButtonComponent from "oxalis/view/components/button_component";
import Store, {
  type OxalisState,
  type MutableTree,
  type MutableNode,
  type MutableTreeMap,
} from "oxalis/store";
import Constants, { type Vector3 } from "oxalis/constants";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import {
  updateDatasetSettingAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import { getVisibleSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import {
  getSynapsesOfAgglomerates,
  getSynapseSources,
  getSynapseDestinations,
  getSynapsePositions,
  getSynapseTypes,
  getConnectomeFilesForDatasetLayer,
} from "admin/admin_rest_api";
import api from "oxalis/api/internal_api";
import {
  loadAgglomerateSkeletonAction,
  removeAgglomerateSkeletonAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { findTreeByName } from "oxalis/model/accessors/skeletontracing_accessor";
import getSceneController from "oxalis/controller/scene_controller_provider";
import {
  initializeConnectomeTracingAction,
  deleteConnectomeTreeAction,
  addConnectomeTreesAction,
  setConnectomeTreeVisibilityAction,
} from "oxalis/model/actions/connectome_actions";
import { stringToAntdColorPreset, stringToAntdColorPresetRgb } from "libs/format_utils";
import { diffArrays } from "libs/utils";
import DiffableMap from "libs/diffable_map";
import EdgeCollection from "oxalis/model/edge_collection";
import Toast from "libs/toast";

const connectomeTabId = "connectome";

type Synapse = { id: number, position: Vector3, type: string };
type SynapticPartners = { [number]: Array<Synapse> };
type Connections = { in: SynapticPartners, out: SynapticPartners };
type ConnectomeData = { [number]: Connections };

type ConnectomeFilters = {
  synapseTypes: Array<string>,
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
  visibleSegmentationLayer: ?APISegmentationLayer,
|};

const mapStateToProps = (state: OxalisState): StateProps => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  return {
    dataset: state.dataset,
    visibleSegmentationLayer,
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
  currentConnectomeFile: ?APIConnectomeFile,
  activeSegmentId: ?number,
  connectomeData: ?ConnectomeData,
  filteredConnectomeData: ?ConnectomeData,
  synapseTypes: Array<string>,
  filters: ConnectomeFilters,
  checkedKeys: Array<string>,
};

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

  const convertSynapsesForPartner = (partners, partnerId1, inOrOut): Array<TreeNode> =>
    Object.keys(partners).map(partnerId2 => ({
      key: `segment-${partnerId1}-${inOrOut}-${partnerId2}`,
      title: `Segment ${partnerId2}`,
      data: segmentData(+partnerId2),
      children: partners[+partnerId2].map(synapse => ({
        key: `synapse-${inOrOut}-${synapse.id}`,
        title: `Synapse ${synapse.id}`,
        data: synapseData(synapse.id, synapse.position, synapse.type),
        children: [],
        checkable: false,
      })),
    }));

  return Object.keys(connectomeData).map(partnerId1 => ({
    key: `segment-${partnerId1}`,
    title: `Segment ${partnerId1}`,
    data: segmentData(+partnerId1),
    children: [
      {
        key: `segment-${partnerId1}-in`,
        title: "Incoming Synapses",
        data: noneData,
        children: convertSynapsesForPartner(connectomeData[+partnerId1].in, partnerId1, "in"),
        checkable: false,
        selectable: false,
      },
      {
        key: `segment-${partnerId1}-out`,
        title: "Outgoing Synapses",
        data: noneData,
        children: convertSynapsesForPartner(connectomeData[+partnerId1].out, partnerId1, "out"),
        checkable: false,
        selectable: false,
      },
    ],
  }));
};

function removeEmpty(obj) {
  return _.omitBy(obj, (value, key: string) => {
    const newValue = _.isPlainObject(value) ? removeEmpty(value) : value;
    obj[key] = newValue;
    return _.isEmpty(newValue);
  });
}

const getFilteredConnectomeData = (
  connectomeData: ?ConnectomeData,
  filters: ?ConnectomeFilters,
): ?ConnectomeData => {
  if (connectomeData == null || filters == null) return connectomeData;

  const { synapseTypes } = filters;

  if (synapseTypes.length === 0) return connectomeData;

  return removeEmpty(
    _.mapValues(_.clone(connectomeData), connections =>
      _.mapValues(connections, partners =>
        _.mapValues(partners, synapses =>
          synapses.filter(
            synapse => synapseTypes.length === 0 || synapseTypes.includes(synapse.type),
          ),
        ),
      ),
    ),
  );
};

const getSynapsesFromConnectomeData = (connectomeData: ConnectomeData): Array<Synapse> =>
  _.flatten(
    // $FlowIssue[incompatible-call] remove once https://github.com/facebook/flow/issues/2221 is fixed
    Object.values(connectomeData).map((connections: Connections) => [
      ..._.flatten(Object.values(connections.in)),
      ..._.flatten(Object.values(connections.out)),
    ]),
  );

const getAgglomerateIdsFromConnectomeData = (connectomeData: ConnectomeData): Array<number> =>
  _.flatten(
    Object.keys(connectomeData).map(partnerId1 => [
      +partnerId1,
      ...Object.keys(connectomeData[+partnerId1].in).map(idString => +idString),
      ...Object.keys(connectomeData[+partnerId1].out).map(idString => +idString),
    ]),
  );

const getTreeNameForAgglomerateSkeleton = (agglomerateId: number, mappingName: string): string =>
  `agglomerate ${agglomerateId} (${mappingName})`;

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
  name: `synapse-${synapseId}`,
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

const defaultFilters = {
  synapseTypes: [],
};

class ConnectomeView extends React.Component<Props, State> {
  state = {
    currentConnectomeFile: null,
    activeSegmentId: null,
    connectomeData: null,
    filteredConnectomeData: null,
    synapseTypes: [],
    filters: defaultFilters,
    checkedKeys: [],
  };

  componentDidMount() {
    this.fetchConnectomeFiles();
    this.initializeSkeleton();
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    if (prevState.activeSegmentId !== this.state.activeSegmentId) {
      this.fetchConnections();
    }
    if (prevProps.visibleSegmentationLayer !== this.props.visibleSegmentationLayer) {
      this.fetchConnectomeFiles();
    }
    if (
      prevState.connectomeData !== this.state.connectomeData ||
      prevState.filters !== this.state.filters
    ) {
      this.updateFilteredConnectomeData(this.state.connectomeData, this.state.filters);
    }
    if (prevState.filteredConnectomeData !== this.state.filteredConnectomeData) {
      this.updateSynapseTrees(prevState.filteredConnectomeData, this.state.filteredConnectomeData);
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
    this.setState({ connectomeData: null, filteredConnectomeData: null, activeSegmentId: null });
  };

  resetFilters = () => {
    this.setState({ filters: defaultFilters });
  };

  initializeSkeleton() {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;

    Store.dispatch(initializeConnectomeTracingAction(visibleSegmentationLayer.name));

    getSceneController().addSkeleton(
      state =>
        Maybe.fromNullable(
          state.localSegmentationData[visibleSegmentationLayer.name].connectomeData.skeleton,
        ),
      false,
    );
  }

  async fetchConnectomeFiles() {
    const { dataset, visibleSegmentationLayer } = this.props;

    if (visibleSegmentationLayer == null) return;

    const connectomeFiles = await getConnectomeFilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(visibleSegmentationLayer),
    );

    const currentConnectomeFile = connectomeFiles[0];
    // TODO: Persist connectome files properly and do not activate mapping
    this.setState({ currentConnectomeFile });

    Store.dispatch(
      setMappingAction(visibleSegmentationLayer.name, currentConnectomeFile.mappingName, "HDF5", {
        showLoadingIndicator: true,
      }),
    );
  }

  async fetchConnections() {
    const { currentConnectomeFile, activeSegmentId, filters } = this.state;
    const { dataset, visibleSegmentationLayer } = this.props;

    if (
      currentConnectomeFile == null ||
      visibleSegmentationLayer == null ||
      activeSegmentId == null
    )
      return;

    const fetchProperties = [
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(visibleSegmentationLayer),
      currentConnectomeFile.connectomeFileName,
    ];
    const synapsesOfAgglomerates = await getSynapsesOfAgglomerates(...fetchProperties, [
      activeSegmentId,
    ]);

    if (synapsesOfAgglomerates.length !== 1) {
      throw new Error(
        `Requested synapses of one agglomerate, but got synapses for ${
          synapsesOfAgglomerates.length
        } agglomerates.`,
      );
    }

    const { in: inSynapses, out: outSynapses } = synapsesOfAgglomerates[0];
    const allSynapses = [...inSynapses, ...outSynapses];

    const [
      synapseSources,
      synapseDestinations,
      synapsePositions,
      synapseTypesAndNames,
    ] = await Promise.all([
      getSynapseSources(...fetchProperties, inSynapses),
      getSynapseDestinations(...fetchProperties, outSynapses),
      getSynapsePositions(...fetchProperties, allSynapses),
      getSynapseTypes(...fetchProperties, allSynapses),
    ]);

    // TODO: Remove once the backend sends the typeToString mapping from the hdf5 file
    if (synapseTypesAndNames.typeToString.length === 0) {
      Toast.error(`Couldn't read synapseTypes mapping. Please add a json file containing the synapseTypes next to the connectome file.
The format should be: \`{
  "synapse_type_names": [ "type1", "type2", ... ]
}\``);
      // Create mocked synapse types
      const largestSynapseTypeId = Math.max(...synapseTypesAndNames.synapseTypes);
      synapseTypesAndNames.typeToString = [...Array(largestSynapseTypeId + 1).keys()].map(
        i => `type${i + 1}`,
      );
    }

    const { synapseTypes, typeToString } = synapseTypesAndNames;

    const connectomeData = { [activeSegmentId]: { in: {}, out: {} } };

    inSynapses.forEach((synapseId, i) => {
      const synapticPartnerId = synapseSources[i];
      if (!(synapticPartnerId in connectomeData[activeSegmentId].in)) {
        connectomeData[activeSegmentId].in[synapticPartnerId] = [];
      }
      connectomeData[activeSegmentId].in[synapticPartnerId].push({
        id: synapseId,
        position: synapsePositions[i],
        type: typeToString[synapseTypes[i]],
      });
    });
    outSynapses.forEach((synapseId, i) => {
      const synapticPartnerId = synapseDestinations[i];
      if (!(synapticPartnerId in connectomeData[activeSegmentId].out)) {
        connectomeData[activeSegmentId].out[synapticPartnerId] = [];
      }
      connectomeData[activeSegmentId].out[synapticPartnerId].push({
        id: synapseId,
        // synapsePositions and synapseTypes contains data for all synapses. inSynapses first and then outSynapses.
        position: synapsePositions[inSynapses.length + i],
        type: typeToString[synapseTypes[inSynapses.length + i]],
      });
    });

    // Remove selected filters that are no longer valid
    const newFilters = { ...filters };
    newFilters.synapseTypes = filters.synapseTypes.filter(synapseType =>
      typeToString.includes(synapseType),
    );

    this.setState({
      connectomeData,
      synapseTypes: typeToString,
      filters: newFilters,
      checkedKeys: [],
    });
  }

  updateFilteredConnectomeData(connectomeData: ?ConnectomeData, filters: ?ConnectomeFilters) {
    const filteredConnectomeData = getFilteredConnectomeData(connectomeData, filters);
    this.setState({ filteredConnectomeData });
  }

  updateSynapseTrees(
    prevFilteredConnectomeData: ?ConnectomeData,
    filteredConnectomeData: ?ConnectomeData,
  ) {
    const { visibleSegmentationLayer } = this.props;

    if (visibleSegmentationLayer == null) return;

    let prevSynapses: Array<Synapse> = [];
    let synapses: Array<Synapse> = [];
    if (prevFilteredConnectomeData != null) {
      prevSynapses = getSynapsesFromConnectomeData(prevFilteredConnectomeData);
    }
    if (filteredConnectomeData != null) {
      synapses = getSynapsesFromConnectomeData(filteredConnectomeData);
    }

    const layerName = visibleSegmentationLayer.name;
    // Find out which synapses were deleted and which were added
    const { onlyA: deletedSynapseIds, onlyB: addedSynapseIds } = diffArrays(
      prevSynapses.map(synapse => synapse.id),
      synapses.map(synapse => synapse.id),
    );

    const skeleton = Store.getState().localSegmentationData[layerName].connectomeData.skeleton;
    if (skeleton == null) return;

    const { trees } = skeleton;

    if (deletedSynapseIds.length) {
      const actions = deletedSynapseIds.map(synapseId =>
        findTreeByName(trees, `synapse-${synapseId}`)
          .map(tree => deleteConnectomeTreeAction(tree.treeId, layerName))
          .getOrElse(null),
      );
      Store.dispatch(batchActions(actions, "DELETE_CONNECTOME_TREES"));
    }

    if (addedSynapseIds.length) {
      const synapseIdToSynapse = _.keyBy(synapses, "id");
      const newTrees: MutableTreeMap = {};
      for (const synapseId of addedSynapseIds) {
        newTrees[synapseId] = synapseTreeCreator(synapseId, synapseIdToSynapse[synapseId].type);
        const synapseNode = synapseNodeCreator(synapseId, synapseIdToSynapse[synapseId].position);
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
    const { visibleSegmentationLayer } = this.props;
    const {
      currentConnectomeFile,
      connectomeData,
      filteredConnectomeData,
      checkedKeys,
    } = this.state;

    if (visibleSegmentationLayer == null || currentConnectomeFile == null) return;

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

    const layerName = visibleSegmentationLayer.name;
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
          Store.dispatch(setConnectomeTreeVisibilityAction(tree.treeId, false, layerName)),
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
            Store.dispatch(setConnectomeTreeVisibilityAction(tree.treeId, true, layerName)),
          Nothing: () =>
            Store.dispatch(
              loadAgglomerateSkeletonAction(layerName, mappingName, agglomerateId, "connectome"),
            ),
        });
      }
    }
  }

  handleChangeActiveSegment = (evt: SyntheticInputEvent<>) => {
    const segmentId = parseInt(evt.target.value, 10);

    this.setState({ activeSegmentId: segmentId });

    evt.target.blur();
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

  handleCheck = (
    { checked }: { checked: Array<string> },
    evt: { checked: boolean, checkedNodes: Array<TreeNode>, node: TreeNode, event: string },
  ) => {
    const { data } = evt.node;

    // Only nodes with type segment are checkable anyways
    if (data.type !== "segment") return;

    this.setState({ checkedKeys: checked });
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

  onChangeSynapseTypeFilter = (synapseTypes: Array<string>) => {
    this.setState({
      filters: {
        synapseTypes,
      },
    });
  };

  getFilterSettings = () => {
    const { synapseTypes, filters } = this.state;

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
        <h4>by Synapse Type</h4>
        <Checkbox.Group
          options={synapseTypeOptions}
          value={filters.synapseTypes}
          onChange={this.onChangeSynapseTypeFilter}
        />
      </div>
    );
  };

  getConnectomeHeader() {
    const { activeSegmentId, filters, synapseTypes } = this.state;
    const activeSegmentIdString = activeSegmentId != null ? activeSegmentId.toString() : "";

    const isAnyFilterAvailable = synapseTypes.length;
    const isAnyFilterActive = filters.synapseTypes.length;

    return (
      <Input.Group compact className="compact-icons">
        <InputComponent
          value={activeSegmentIdString}
          onPressEnter={this.handleChangeActiveSegment}
          placeholder="Show Synaptic Connections for Segment ID"
          style={{ width: "280px" }}
        />
        <ButtonComponent onClick={this.reset}>Reset</ButtonComponent>
        <Tooltip title="Configure Filters">
          <Popover content={this.getFilterSettings} trigger="click" placement="bottom">
            <ButtonComponent disabled={!isAnyFilterAvailable}>
              <FilterOutlined style={isAnyFilterActive ? { color: "red" } : {}} />
            </ButtonComponent>
          </Popover>
        </Tooltip>
      </Input.Group>
    );
  }

  render() {
    const { visibleSegmentationLayer } = this.props;
    const { activeSegmentId, filteredConnectomeData, currentConnectomeFile } = this.state;

    return (
      <div id={connectomeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={connectomeTabId}>
          {_isVisibleInDom => {
            // if (!isVisibleInDom) return null;

            if (!visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            if (currentConnectomeFile == null) {
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
                {activeSegmentId == null ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No segment selected. Use the input field above to enter a segment ID."
                  />
                ) : null}
                {filteredConnectomeData != null ? (
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
                          titleRender={this.renderNode}
                          treeData={convertConnectomeToTreeData(filteredConnectomeData)}
                        />
                      </div>
                    )}
                  </AutoSizer>
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
