// @flow
import { Button, ConfigProvider, List, Tooltip, Select, Popover, Empty } from "antd";
import { LoadingOutlined, ReloadOutlined, SettingOutlined, PlusOutlined } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import memoizeOne from "memoize-one";

import DataLayer from "oxalis/model/data_layer";
import DomVisibilityObserver from "oxalis/view/components/dom_visibility_observer";
import Toast from "libs/toast";
import type { ExtractReturn } from "libs/type_helpers";

import type { APISegmentationLayer, APIUser, APIDataset } from "types/api_flow_types";
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
import { startComputeMeshFileJob, getJobs } from "admin/admin_rest_api";
import Model from "oxalis/model";

import SegmentListItem from "oxalis/view/right-border-tabs/segments_tab/segment_list_item";

const { Option } = Select;

// Interval in ms to check for running mesh file computation jobs for this dataset
const refreshInterval = 5000;

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111], // ASCII codes for ISO
  cellIdIndex: 3, // Write cell index after the isosurfaceMarker
};

const segmentsTabId = "segment-list";

type StateProps = {|
  isosurfaces: { [segmentId: number]: IsosurfaceInformation },
  dataset: APIDataset,
  isJSONMappingEnabled: boolean,
  mappingInfo: ActiveMappingInfo,
  flycam: Flycam,
  hasVolume: boolean,
  hoveredSegmentId: ?number,
  segments: ?SegmentMap,
  visibleSegmentationLayer: ?APISegmentationLayer,
  allowUpdate: boolean,
  organization: string,
  datasetName: string,
  availableMeshFiles: ?Array<string>,
  currentMeshFile: ?string,
  activeUser: ?APIUser,
  activeCellId: ?number,
  preferredQualityForMeshPrecomputation: number,
  preferredQualityForMeshAdHocComputation: number,
  resolutionInfoOfVisibleSegmentationLayer: ResolutionInfo,
|};

const mapStateToProps = (state: OxalisState): StateProps => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  const mappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
  );
  return {
    activeCellId: state.tracing.volume != null ? state.tracing.volume.activeCellId : null,
    isosurfaces:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].isosurfaces
        : {},
    dataset: state.dataset,
    isJSONMappingEnabled: mappingInfo.isMappingEnabled && mappingInfo.mappingType === "JSON",
    mappingInfo,
    flycam: state.flycam,
    hasVolume: state.tracing.volume != null,
    hoveredSegmentId: state.temporaryConfiguration.hoveredSegmentId,
    segments: getVisibleSegments(state),
    visibleSegmentationLayer,
    allowUpdate: state.tracing.restrictions.allowUpdate,
    organization: state.dataset.owningOrganization,
    datasetName: state.dataset.name,
    availableMeshFiles:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].availableMeshFiles
        : null,
    currentMeshFile:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].currentMeshFile
        : null,
    activeUser: state.activeUser,
    preferredQualityForMeshPrecomputation:
      state.temporaryConfiguration.preferredQualityForMeshPrecomputation,
    preferredQualityForMeshAdHocComputation:
      state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
    resolutionInfoOfVisibleSegmentationLayer: getResolutionInfoOfVisibleSegmentationLayer(state),
  };
};

const mapDispatchToProps = (dispatch: Dispatch<*>): * => ({
  onChangeDatasetSettings(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  deleteMesh(id: string) {
    dispatch(deleteMeshAction(id));
  },
  setHoveredSegmentId(segmentId: ?number) {
    dispatch(updateTemporarySettingAction("hoveredSegmentId", segmentId));
  },
  async onStlUpload(layerName: string, info) {
    dispatch(setImportingMeshStateAction(true));
    const buffer = await readFileAsArrayBuffer(info.file);

    if (isIsosurfaceStl(buffer)) {
      trackAction("Import Isosurface Mesh from STL");
      dispatch(importIsosurfaceFromStlAction(layerName, buffer));
    } else {
      trackAction("Import STL");
      dispatch(createMeshFromBufferAction(info.file.name, buffer));
    }
  },
  downloadIsosurface() {
    dispatch(triggerActiveIsosurfaceDownloadAction());
  },
  changeActiveIsosurfaceId(cellId: ?number, seedPosition: Vector3, shouldReload: boolean) {
    if (cellId == null) {
      return;
    }
    dispatch(changeActiveIsosurfaceCellAction(cellId, seedPosition, shouldReload));
  },
  setCurrentMeshFile(layerName: string, fileName: string) {
    dispatch(updateCurrentMeshFileAction(layerName, fileName));
  },
  setPosition(position: Vector3, shouldRefreshIsosurface?: boolean) {
    dispatch(setPositionAction(position, null, shouldRefreshIsosurface));
  },
  updateSegment(segmentId: number, segmentShape: $Shape<Segment>) {
    dispatch(updateSegmentAction(segmentId, segmentShape));
  },
});

type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = {| ...DispatchProps, ...StateProps |};

type State = {
  selectedSegmentId: ?number,
  activeMeshJobId: ?string,
  activeDropdownSegmentId: ?number,
};

const getSortedSegments = memoizeOne((segments: ?SegmentMap) =>
  _.sortBy(segments ? Array.from(segments.values()) : [], "id"),
);

const formatMagWithLabel = (mag: Vector3, index: number) => {
  // index refers to the array of available mags. Thus, we can directly
  // use that index to pick an adequate label.
  const labels = ["Highest", "High", "Medium", "Low", "Very Low"];
  // Use "Very Low" for all low Mags which don't have extra labels
  const clampedIndex = Math.min(labels.length - 1, index);
  return `${labels[clampedIndex]} (Mag ${mag.join("-")})`;
};

function _getMapIdFn(visibleSegmentationLayer: ?DataLayer) {
  const mapId =
    visibleSegmentationLayer != null ? id => visibleSegmentationLayer.cube.mapId(id) : id => id;
  return mapId;
}

const getMapIdFn = memoizeOne(_getMapIdFn);

function renderEmptyMeshFileSelect() {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description="No mesh file found. Click the + icon to compute a mesh file."
    />
  );
}

class SegmentsView extends React.Component<Props, State> {
  intervalID: ?TimeoutID;

  state = {
    selectedSegmentId: null,
    activeMeshJobId: null,
    activeDropdownSegmentId: null,
  };

  componentDidMount() {
    maybeFetchMeshFiles(this.props.visibleSegmentationLayer, this.props.dataset, false);
    if (features().jobsEnabled) {
      this.pollJobData();
    }
  }

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  async pollJobData(): Promise<void> {
    const jobs = this.props.activeUser != null ? await getJobs() : [];

    const oldActiveJobId = this.state.activeMeshJobId;

    const meshJobsForDataset = jobs.filter(
      job => job.type === "compute_mesh_file" && job.datasetName === this.props.datasetName,
    );
    const activeJob =
      oldActiveJobId != null ? meshJobsForDataset.find(job => job.id === oldActiveJobId) : null;

    if (activeJob != null) {
      // We are aware of a running mesh job. Check whether the job is finished now.
      switch (activeJob.state) {
        case "SUCCESS": {
          Toast.success(
            'The computation of a mesh file for this dataset has finished. You can now use the "Load Mesh (precomputed)" functionality in the context menu.',
          );
          this.setState({ activeMeshJobId: null });
          // maybeFetchMeshFiles will fetch the new mesh file and also activate it if no other mesh file
          // currently exists.
          maybeFetchMeshFiles(this.props.visibleSegmentationLayer, this.props.dataset, true);
          break;
        }
        case "STARTED":
        case "UNKNOWN":
        case "PENDING": {
          break;
        }
        case "FAILURE": {
          Toast.info("The computation of a mesh file for this dataset didn't finish properly.");
          this.setState({ activeMeshJobId: null });
          break;
        }
        case "MANUAL": {
          Toast.info(
            "The computation of a mesh file for this dataset didn't finish properly. The job will be handled by an admin shortly. Please check back here soon.",
          );
          this.setState({ activeMeshJobId: null });
          break;
        }
        default: {
          break;
        }
      }
    } else {
      // Check whether there is an active mesh job (e.g., the user
      // started the job earlier and reopened webKnossos in the meantime).

      const pendingJobs = meshJobsForDataset.filter(
        job => job.state === "STARTED" || job.state === "PENDING",
      );
      const activeMeshJobId = pendingJobs.length > 0 ? pendingJobs[0].id : null;
      this.setState({
        activeMeshJobId,
      });
    }

    // refresh according to the refresh interval
    this.intervalID = setTimeout(() => this.pollJobData(), refreshInterval);
  }

  getPrecomputeMeshesTooltipInfo = () => {
    let title = "";
    let disabled = true;
    if (!features().jobsEnabled) {
      title = "Computation jobs are not enabled for this webKnossos instance.";
    } else if (this.props.activeUser == null) {
      title = "Please log in to precompute the meshes of this dataset.";
    } else if (!this.props.dataset.jobsEnabled) {
      title =
        "Meshes Computation is not supported for datasets that are not natively hosted on the server. Upload your dataset directly to weknossos.org to enable this feature.";
    } else if (this.props.hasVolume) {
      title =
        this.props.visibleSegmentationLayer != null &&
        this.props.visibleSegmentationLayer.fallbackLayer
          ? "Meshes cannot be precomputed for volume annotations. However, you can open this dataset in view mode to precompute meshes for the dataset's segmentation layer."
          : "Meshes cannot be precomputed for volume annotations.";
    } else if (this.props.visibleSegmentationLayer == null) {
      title = "There is no segmentation layer for which meshes could be precomputed.";
    } else {
      title =
        "Precompute meshes for all segments of this dataset so that meshes for segments can be loaded quickly afterwards from a mesh file.";
      disabled = false;
    }

    return {
      disabled,
      title,
    };
  };

  loadPrecomputedMeshForSegment = async (segment: Segment) => {
    const { dataset, currentMeshFile, visibleSegmentationLayer } = this.props;
    if (!currentMeshFile || !visibleSegmentationLayer) {
      return;
    }
    await loadMeshFromFile(
      segment.id,
      segment.somePosition,
      currentMeshFile,
      visibleSegmentationLayer,
      dataset,
    );
  };

  onSelectSegment = (segment: Segment) => {
    this.setState({ selectedSegmentId: segment.id });
    this.props.setPosition(segment.somePosition);
  };

  handleSegmentDropdownMenuVisibility = (segmentId: number, isVisible: boolean) => {
    if (isVisible) {
      this.setState({ activeDropdownSegmentId: segmentId });
      return;
    }
    this.setState({ activeDropdownSegmentId: null });
  };

  startComputingMeshfile = async () => {
    const {
      preferredQualityForMeshPrecomputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;
    const defaultOrHigherIndex = datasetResolutionInfo.getIndexOrClosestHigherIndex(
      preferredQualityForMeshPrecomputation,
    );

    const meshfileResolutionIndex =
      defaultOrHigherIndex != null
        ? defaultOrHigherIndex
        : datasetResolutionInfo.getClosestExistingIndex(preferredQualityForMeshPrecomputation);

    const meshfileResolution = datasetResolutionInfo.getResolutionByIndexWithFallback(
      meshfileResolutionIndex,
    );

    if (this.props.visibleSegmentationLayer != null) {
      const job = await startComputeMeshFileJob(
        this.props.organization,
        this.props.datasetName,
        getBaseSegmentationName(this.props.visibleSegmentationLayer),
        meshfileResolution,
      );
      this.setState({ activeMeshJobId: job.id });
      Toast.info(
        <React.Fragment>
          The computation of a mesh file was started. For large datasets, this may take a while.
          Closing this tab will not stop the computation.
          <br />
          See{" "}
          <a target="_blank" href="/jobs" rel="noopener noreferrer">
            Processing Jobs
          </a>{" "}
          for an overview of running jobs.
        </React.Fragment>,
      );
    } else {
      Toast.error(
        "The computation of a mesh file could not be started because no segmentation layer was found.",
      );
    }
  };

  handleMeshFileSelected = async (mesh: { key: ?string }) => {
    if (this.props.visibleSegmentationLayer != null && mesh.key != null) {
      this.props.setCurrentMeshFile(this.props.visibleSegmentationLayer.name, mesh.key);
    }
  };

  handleQualityChangeForPrecomputation = (resolutionIndex: number) =>
    Store.dispatch(
      updateTemporarySettingAction("preferredQualityForMeshPrecomputation", resolutionIndex),
    );

  handleQualityChangeForAdHocGeneration = (resolutionIndex: number) =>
    Store.dispatch(
      updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", resolutionIndex),
    );

  getAdHocMeshSettings = () => {
    const {
      preferredQualityForMeshAdHocComputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;
    return (
      <div>
        <Tooltip title="The higher the quality, the more computational resources are required">
          <div>Quality for Ad-Hoc Mesh Computation:</div>
        </Tooltip>
        <Select
          size="small"
          style={{ width: 220 }}
          value={datasetResolutionInfo.getClosestExistingIndex(
            preferredQualityForMeshAdHocComputation,
          )}
          onChange={this.handleQualityChangeForAdHocGeneration}
        >
          {datasetResolutionInfo.getResolutionsWithIndices().map(([log2Index, mag], index) => (
            <Option value={log2Index} key={log2Index}>
              {formatMagWithLabel(mag, index)}
            </Option>
          ))}
        </Select>
      </div>
    );
  };

  getPreComputeMeshesPopover = () => {
    const { disabled, title } = this.getPrecomputeMeshesTooltipInfo();

    const {
      preferredQualityForMeshPrecomputation,
      resolutionInfoOfVisibleSegmentationLayer: datasetResolutionInfo,
    } = this.props;

    return (
      <div style={{ maxWidth: 500 }}>
        <h3>Precompute Meshes</h3>
        <p>
          Mesh visualizations can be very helpful when exploring segmentations. webKnossos can
          precompute all meshes for a segmentation layer. Once the precomputation has finished,
          individual meshes can be loaded very quickly. As an alternative, you can use the ad-hoc
          mesh functionality which is a bit slower but does not require pre-computation.
        </p>

        <div>
          <div>
            <Tooltip title="The higher the quality, the more computational resources are required">
              Quality for Mesh Precomputation:
            </Tooltip>
          </div>

          <Select
            size="small"
            style={{ width: 220 }}
            value={datasetResolutionInfo.getClosestExistingIndex(
              preferredQualityForMeshPrecomputation,
            )}
            onChange={this.handleQualityChangeForPrecomputation}
          >
            {datasetResolutionInfo.getResolutionsWithIndices().map(([log2Index, mag], index) => (
              <Option value={log2Index} key={log2Index}>
                {formatMagWithLabel(mag, index)}
              </Option>
            ))}
          </Select>
        </div>

        <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
          <Tooltip title={title}>
            <Button
              size="large"
              loading={this.state.activeMeshJobId != null}
              type="primary"
              disabled={disabled}
              onClick={this.startComputingMeshfile}
            >
              Precompute Meshes
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  };

  getMeshesHeader = () => (
    <div>
      <Tooltip title="Select a mesh file from which precomputed meshes will be loaded.">
        <ConfigProvider renderEmpty={renderEmptyMeshFileSelect}>
          <Select
            style={{ width: 180, display: "inline-blck" }}
            placeholder="Select a mesh file"
            value={this.props.currentMeshFile}
            onChange={this.handleMeshFileSelected}
            size="small"
            loading={this.props.availableMeshFiles == null}
          >
            {this.props.availableMeshFiles ? (
              this.props.availableMeshFiles.map(meshFile => (
                <Option key={meshFile} value={meshFile}>
                  {meshFile}
                </Option>
              ))
            ) : (
              <Option value={null} disabled>
                No files available.
              </Option>
            )}
          </Select>
        </ConfigProvider>
      </Tooltip>
      <Tooltip title="Refresh list of available Mesh files">
        <ReloadOutlined
          key="refresh"
          onClick={() =>
            maybeFetchMeshFiles(this.props.visibleSegmentationLayer, this.props.dataset, true)
          }
          style={{ marginLeft: 8 }}
        >
          Reload from Server
        </ReloadOutlined>
      </Tooltip>
      <Popover content={this.getPreComputeMeshesPopover} trigger="click" placement="bottom">
        <Tooltip title="Add a precomputed mesh file">
          <PlusOutlined />
        </Tooltip>
      </Popover>
      {this.state.activeMeshJobId != null ? (
        <Tooltip title='A mesh file is currently being computed. See "Processing Jobs" for more information.'>
          <LoadingOutlined />
        </Tooltip>
      ) : null}
      <Tooltip title="Configure ad-hoc mesh computation">
        <Popover content={this.getAdHocMeshSettings} trigger="click" placement="bottom">
          <SettingOutlined />
        </Popover>
      </Tooltip>
    </div>
  );

  render() {
    return (
      <div id={segmentsTabId} className="padded-tab-content">
        <DomVisibilityObserver targetId={segmentsTabId}>
          {isVisibleInDom => {
            if (!isVisibleInDom) return null;

            const centeredSegmentId = getSegmentIdForPosition(getPosition(this.props.flycam));
            const allSegments = getSortedSegments(this.props.segments);

            const visibleSegmentationLayer = Model.getVisibleSegmentationLayer();
            const mapId = getMapIdFn(visibleSegmentationLayer);

            if (!visibleSegmentationLayer) {
              return (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No segmentation layer visible."
                />
              );
            }

            return (
              <React.Fragment>
                {this.getMeshesHeader()}

                {allSegments.length === 0 ? (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={`There are no segments yet. ${
                      this.props.allowUpdate && this.props.hasVolume
                        ? "Use the volume tools (e.g., the brush) to create a segment. Alternatively, select or click existing segments to add them to this list."
                        : "Select or click existing segments to add them to this list."
                    }`}
                  />
                ) : (
                  <List
                    size="small"
                    split={false}
                    style={{ marginTop: 12, flex: "1 1 auto", overflow: "auto" }}
                  >
                    {allSegments.map(segment => (
                      <SegmentListItem
                        key={segment.id}
                        mapId={mapId}
                        segment={segment}
                        centeredSegmentId={centeredSegmentId}
                        loadPrecomputedMeshForSegment={this.loadPrecomputedMeshForSegment}
                        selectedSegmentId={this.state.selectedSegmentId}
                        activeDropdownSegmentId={this.state.activeDropdownSegmentId}
                        onSelectSegment={this.onSelectSegment}
                        handleSegmentDropdownMenuVisibility={
                          this.handleSegmentDropdownMenuVisibility
                        }
                        isosurface={this.props.isosurfaces[segment.id]}
                        {...this.props}
                      />
                    ))}
                  </List>
                )}
              </React.Fragment>
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
)(SegmentsView);
