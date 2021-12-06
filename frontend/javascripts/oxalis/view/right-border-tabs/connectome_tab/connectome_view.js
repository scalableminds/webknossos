// @flow
import { Button, ConfigProvider, Input, List, Tooltip, Select, Popover, Empty, Tree } from "antd";
import { LoadingOutlined, ReloadOutlined, SettingOutlined, PlusOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";
import Maybe from "data.maybe";

import DataLayer from "oxalis/model/data_layer";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import Toast from "libs/toast";
import type { ExtractReturn } from "libs/type_helpers";

import type {
  APISegmentationLayer,
  APIUser,
  APIDataset,
  APIConnectomeFile,
} from "types/api_flow_types";
import InputComponent from "oxalis/view/components/input_component";
import type {
  OxalisState,
  Flycam,
  IsosurfaceInformation,
  Segment,
  SegmentMap,
  ActiveMappingInfo,
} from "oxalis/store";
import Store from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import {
  createMeshFromBufferAction,
  deleteMeshAction,
  importIsosurfaceFromStlAction,
  triggerActiveIsosurfaceDownloadAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import features from "features";
import {
  loadMeshFromFile,
  maybeFetchMeshFiles,
  getBaseSegmentationName,
} from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import {
  updateDatasetSettingAction,
  updateTemporarySettingAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { updateSegmentAction } from "oxalis/model/actions/volumetracing_actions";
import { getVisibleSegments } from "oxalis/model/accessors/volumetracing_accessor";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getVisibleSegmentationLayer,
  getResolutionInfoOfVisibleSegmentationLayer,
  getMappingInfo,
  ResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { isIsosurfaceStl } from "oxalis/model/sagas/isosurface_saga";
import { readFileAsArrayBuffer } from "libs/read_file";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import { trackAction } from "oxalis/model/helpers/analytics";
import {
  getSynapticPartnersOfAgglomerate,
  getSynapsesOfAgglomeratePairs,
  getSynapsePositions,
  getConnectomeFilesForDatasetLayer,
} from "admin/admin_rest_api";
import Model from "oxalis/model";

import SegmentListItem from "oxalis/view/right-border-tabs/segments_tab/segment_list_item";
import api from "oxalis/api/internal_api";
import { loadAgglomerateSkeletonAction } from "oxalis/model/actions/skeletontracing_actions";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { initializeConnectomeTracingAction } from "oxalis/model/actions/connectome_actions";

const { Option } = Select;

const connectomeTabId = "connectome";

type Synapse = { id: number, position: Vector3 };
type ConnectomeData = { [number]: { [number]: Array<Synapse> } };

type SegmentData = { type: "segment", id: number };
type SynapseData = { type: "synapse", id: number, position: Vector3 };
type TreeNode = {
  key: string,
  title: string,
  children: Array<TreeNode>,
  disabled?: boolean,
  selectable?: boolean,
  checkable?: boolean,
  data: SegmentData | SynapseData,
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
};

const segmentData = (segmentId: number): SegmentData => ({
  type: "segment",
  id: segmentId,
});
const synapseData = (synapseId: number, position: Vector3): SynapseData => ({
  type: "synapse",
  id: synapseId,
  position,
});

const _convertConnectomeToTreeData = (connectomeData: ?ConnectomeData): ?TreeData => {
  if (connectomeData == null) return null;

  return Object.keys(connectomeData).map(partnerId1 => ({
    key: `segment-${partnerId1}`,
    title: `Segment ${partnerId1}`,
    data: segmentData(+partnerId1),
    children: Object.keys(connectomeData[+partnerId1]).map(partnerId2 => ({
      key: `segment-${partnerId1}-${partnerId2}`,
      title: `Segment ${partnerId2}`,
      data: segmentData(+partnerId2),
      children: connectomeData[+partnerId1][+partnerId2].map(synapse => ({
        key: `synapse-${synapse.id}`,
        title: `Synapse ${synapse.id}`,
        data: synapseData(synapse.id, synapse.position),
        children: [],
        checkable: false,
      })),
    })),
  }));
};

const convertConnectomeToTreeData = memoizeOne(_convertConnectomeToTreeData);

class ConnectomeView extends React.Component<Props, State> {
  state = {
    currentConnectomeFile: null,
    activeSegmentId: null,
    connectomeData: null,
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
  }

  componentWillUnmount() {}

  initializeSkeleton() {
    const { visibleSegmentationLayer } = this.props;
    if (visibleSegmentationLayer == null) return;

    Store.dispatch(initializeConnectomeTracingAction(visibleSegmentationLayer.name));

    getSceneController().addSkeleton(state => {
      const { skeleton } = state.localSegmentationData[
        visibleSegmentationLayer.name
      ].connectomeData;

      if (skeleton == null) return Maybe.Nothing();

      const { trees, activeNodeId, activeTreeId, tracingId } = skeleton;
      return Maybe.of({ trees, activeNodeId, activeTreeId, tracingId });
    }, false);
  }

  fetchConnectomeFiles() {
    const { dataset, visibleSegmentationLayer } = this.props;

    if (visibleSegmentationLayer == null) return;

    const connectomeFiles = getConnectomeFilesForDatasetLayer(
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

  fetchConnections() {
    const { currentConnectomeFile, activeSegmentId } = this.state;
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
    const synapticPartners = getSynapticPartnersOfAgglomerate(...fetchProperties, activeSegmentId);
    const synapseIdsPerPair = getSynapsesOfAgglomeratePairs(
      ...fetchProperties,
      activeSegmentId,
      synapticPartners,
    );
    const synapsePositions = synapseIdsPerPair.map(synapseIds =>
      getSynapsePositions(...fetchProperties, synapseIds),
    );

    const connectomeData = { [activeSegmentId]: {} };
    synapticPartners.forEach((partnerId, i) => {
      connectomeData[activeSegmentId][partnerId] = synapseIdsPerPair[i].map((synapseId, j) => ({
        id: synapseId,
        position: synapsePositions[i][j],
      }));
    });

    this.setState({ connectomeData });
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
    checkedKeys: Array<string>,
    evt: { checked: boolean, checkedNodes: Array<TreeNode>, node: TreeNode, event: string },
  ) => {
    const { data } = evt.node;
    if (data.type === "synapse" && evt.checked) {
      api.tracing.setCameraPosition(data.position);
    } else if (data.type === "segment" && evt.checked) {
      const { visibleSegmentationLayer } = this.props;
      const { currentConnectomeFile } = this.state;
      if (
        visibleSegmentationLayer != null &&
        currentConnectomeFile != null &&
        currentConnectomeFile.mappingName != null
      ) {
        Store.dispatch(
          loadAgglomerateSkeletonAction(
            visibleSegmentationLayer.name,
            currentConnectomeFile.mappingName,
            data.id,
            "connectome",
          ),
        );
      }
    }
  };

  getConnectomeHeader() {
    const { activeSegmentId } = this.state;
    const activeSegmentIdString = activeSegmentId != null ? activeSegmentId.toString() : "";
    return (
      <InputComponent
        value={activeSegmentIdString}
        onPressEnter={this.handleChangeActiveSegment}
        placeholder="Show Synaptic Connections for Segment ID"
        style={{ width: "280px" }}
      />
    );
  }

  render() {
    const visibleSegmentationLayer = Model.getVisibleSegmentationLayer();

    return (
      <div id={connectomeTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={connectomeTabId}>
          {isVisibleInDom => {
            // if (!isVisibleInDom) return null;

            if (!visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            if (this.state.currentConnectomeFile == null) {
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
                {this.state.activeSegmentId == null ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description="No segment selected. Use the input field above to enter a segment ID."
                  />
                ) : null}
                {this.state.connectomeData != null ? (
                  <Tree
                    checkable
                    checkStrictly
                    defaultExpandAll
                    showLine={{ showLeafIcon: false }}
                    onSelect={this.handleSelect}
                    onCheck={this.handleCheck}
                    treeData={convertConnectomeToTreeData(this.state.connectomeData)}
                  />
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
