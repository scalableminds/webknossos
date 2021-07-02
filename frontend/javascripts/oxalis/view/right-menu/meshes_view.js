// @flow
import { Button, List, Tooltip, Upload, Dropdown, Menu } from "antd";
import {
  DeleteOutlined,
  EllipsisOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import api from "oxalis/api/internal_api";
import Toast from "libs/toast";
import type { ExtractReturn } from "libs/type_helpers";
import type { RemoteMeshMetaData } from "types/api_flow_types";
import type { OxalisState, IsosurfaceInformation } from "oxalis/store";
import Store from "oxalis/store";
import Model from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import {
  createMeshFromBufferAction,
  deleteMeshAction,
  importIsosurfaceFromStlAction,
  triggerActiveIsosurfaceDownloadAction,
  triggerIsosurfaceDownloadAction,
  updateIsosurfaceVisibilityAction,
  updateRemoteMeshMetaDataAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
  addIsosurfaceAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import features from "features";
import { loadMeshFromFile, maybeFetchMeshFiles } from "oxalis/view/right-menu/meshes_view_helper";
import { updateDatasetSettingAction } from "oxalis/model/actions/settings_actions";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import {
  getPosition,
  getRequestLogZoomStep,
  getCurrentResolution,
} from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayer,
  getDatasetResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { isIsosurfaceStl } from "oxalis/model/sagas/isosurface_saga";
import { readFileAsArrayBuffer } from "libs/read_file";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import { trackAction } from "oxalis/model/helpers/analytics";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import classnames from "classnames";
import { startComputeMeshFileJob, getJobs } from "admin/admin_rest_api";
import Checkbox from "antd/lib/checkbox/Checkbox";
import MenuItem from "antd/lib/menu/MenuItem";

// $FlowIgnore[prop-missing] flow does not know that Dropdown has a Button
const DropdownButton = Dropdown.Button;

// Interval to check if there is a running mesh file computation for this dataset
const refreshInterval = 30000;
const defaultMeshfileGenerationResolutionIndex = 2;

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111], // ASCII codes for ISO
  cellIdIndex: 3, // Write cell index after the isosurfaceMarker
};

// This file defines the component MeshesView.

const mapStateToProps = (state: OxalisState): * => ({
  meshes: state.tracing != null ? state.tracing.meshes : [],
  isImporting: state.uiInformation.isImportingMesh,
  isosurfaces: state.isosurfaces,
  datasetConfiguration: state.datasetConfiguration,
  dataset: state.dataset,
  mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
  flycam: state.flycam,
  activeCellId: state.tracing.volume ? state.tracing.volume.activeCellId : null,
  segmentationLayer: getSegmentationLayer(state.dataset),
  zoomStep: getRequestLogZoomStep(state),
  allowUpdate: state.tracing.restrictions.allowUpdate,
  activeResolution: getCurrentResolution(state),
  organization: state.dataset.owningOrganization,
  datasetName: state.dataset.name,
  availableMeshFiles: state.availableMeshFiles,
  currentMeshFile: state.currentMeshFile,
});

const mapDispatchToProps = (dispatch: Dispatch<*>): * => ({
  updateRemoteMeshMetadata(id: string, meshMetaData: $Shape<RemoteMeshMetaData>) {
    dispatch(updateRemoteMeshMetaDataAction(id, meshMetaData));
  },
  onChangeDatasetSettings(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  deleteMesh(id: string) {
    dispatch(deleteMeshAction(id));
  },
  onChangeVisibility(id, isVisible: boolean) {
    dispatch(updateIsosurfaceVisibilityAction(id, isVisible));
  },
  async onStlUpload(info) {
    dispatch(setImportingMeshStateAction(true));
    const buffer = await readFileAsArrayBuffer(info.file);

    if (isIsosurfaceStl(buffer)) {
      trackAction("Import Isosurface Mesh from STL");
      dispatch(importIsosurfaceFromStlAction(buffer));
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
  addPrecomputedMesh(cellId, seedPosition) {
    if (cellId == null) {
      return;
    }
    dispatch(addIsosurfaceAction(cellId, seedPosition, true));
  },
  setCurrentMeshFile(fileName) {
    dispatch(updateCurrentMeshFileAction(fileName));
  },
});

type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;
type StateProps = ExtractReturn<typeof mapStateToProps>;

type Props = {| ...DispatchProps, ...StateProps |};

type State = { hoveredListItem: ?number, activeMeshJobId: ?string };

class MeshesView extends React.Component<Props, State> {
  intervalID: ?TimeoutID;

  state = {
    hoveredListItem: null,
    activeMeshJobId: null,
  };

  componentDidMount() {
    maybeFetchMeshFiles(this.props.segmentationLayer, this.props.dataset, false);
    this.pollJobData();
  }

  componentWillUnmount() {
    if (this.intervalID != null) {
      clearTimeout(this.intervalID);
    }
  }

  async pollJobData(): Promise<void> {
    const jobs = await getJobs();
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
            'The computation of a mesh file for this dataset has finished. You can now use the "Load Precomputed Mesh" in the "Meshes" tab.',
          );
          this.setState({ activeMeshJobId: null });
          // maybeFetchMeshFiles will fetch the new mesh file and also activate it if no other mesh file
          // currently exists.
          maybeFetchMeshFiles(this.props.segmentationLayer, this.props.dataset, true);
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

  render() {
    const hasSegmentation = Model.getSegmentationLayer() != null;
    const getSegmentationCube = () => {
      const layer = Model.getSegmentationLayer();
      if (!layer) {
        throw new Error("No segmentation layer found");
      }
      return layer.cube;
    };
    const getIdForPos = pos => {
      const segmentationCube = getSegmentationCube();
      const segmentationLayerName = Model.getSegmentationLayerName();

      if (!segmentationLayerName) {
        return 0;
      }

      const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
        segmentationLayerName,
        pos,
      );
      return segmentationCube.getDataValue(pos, null, renderedZoomStepForCameraPosition);
    };

    const moveTo = (seedPosition: Vector3) => {
      Store.dispatch(setPositionAction(seedPosition, null, false));
    };

    const startComputingMeshfile = async () => {
      const datasetResolutionInfo = getDatasetResolutionInfo(this.props.dataset);
      const defaultOrHigherIndex = datasetResolutionInfo.getIndexOrClosestHigherIndex(
        defaultMeshfileGenerationResolutionIndex,
      );

      const meshfileResolutionIndex =
        defaultOrHigherIndex != null
          ? defaultOrHigherIndex
          : datasetResolutionInfo.getClosestExistingIndex(defaultMeshfileGenerationResolutionIndex);

      const meshfileResolution = datasetResolutionInfo.getResolutionByIndexWithFallback(
        meshfileResolutionIndex,
      );

      if (this.props.segmentationLayer != null) {
        const job = await startComputeMeshFileJob(
          this.props.organization,
          this.props.datasetName,
          this.props.segmentationLayer.fallbackLayer || this.props.segmentationLayer.name,
          meshfileResolution,
        );
        this.setState({ activeMeshJobId: job.id });
        Toast.success(
          "The computation of a mesh file was started successfully. Depending on the dataset's size this may take a bit. You don't need to keep this dataset open for the computation to continue.",
        );
      } else {
        Toast.error(
          "The computation of a mesh file could not be started because no segmentation layer was found.",
        );
      }
    };

    const getComputeMeshfileTooltip = node => (
      <Tooltip
        title={
          features().jobsEnabled
            ? "Compute a mesh file for this dataset so that meshes for segments can be loaded quickly afterwards."
            : "The computation of mesh files is not supported by this webKnossos instance."
        }
      >
        {node}
      </Tooltip>
    );

    const getComputeMeshFileButton = () =>
      getComputeMeshfileTooltip(
        <Button
          size="small"
          loading={this.state.activeMeshJobId != null}
          onClick={startComputingMeshfile}
          disabled={!features().jobsEnabled}
        >
          Compute Mesh File
        </Button>,
      );

    const getDownloadButton = (segmentId: number) => (
      <Tooltip title="Download Isosurface">
        <VerticalAlignBottomOutlined
          key="download-button"
          onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segmentId))}
        />
      </Tooltip>
    );
    const getRefreshButton = (segmentId: number, isPrecomputed: boolean, isLoading: boolean) => {
      if (isLoading) {
        return (
          <LoadingOutlined
            key="refresh-button"
            onClick={() => {
              Store.dispatch(refreshIsosurfaceAction(segmentId));
            }}
          />
        );
      } else {
        return isPrecomputed ? null : (
          <Tooltip title="Refresh Isosurface">
            <ReloadOutlined
              key="refresh-button"
              onClick={() => {
                Store.dispatch(refreshIsosurfaceAction(segmentId));
              }}
            />
          </Tooltip>
        );
      }
    };
    const getDeleteButton = (segmentId: number) => (
      <Tooltip title="Delete Isosurface">
        <DeleteOutlined
          key="delete-button"
          onClick={() => {
            Store.dispatch(removeIsosurfaceAction(segmentId));
            // reset the active isosurface id so the deleted one is not reloaded immediately
            this.props.changeActiveIsosurfaceId(0, [0, 0, 0], false);
          }}
        />
      </Tooltip>
    );
    const convertHSLAToCSSString = ([h, s, l, a]) =>
      `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
    const convertCellIdToCSS = id =>
      convertHSLAToCSSString(jsConvertCellIdToHSLA(id, this.props.mappingColors));

    const getStlImportItem = () => (
      <Upload
        accept=".stl"
        beforeUpload={() => false}
        onChange={file => {
          this.props.onStlUpload(file);
        }}
        showUploadList={false}
        style={{ fontSize: 16, cursor: "pointer" }}
        disabled={!this.props.allowUpdate || this.props.isImporting}
      >
        Import STL
      </Upload>
    );

    const getLoadMeshCellButton = () => (
      <Button
        onClick={() => {
          const pos = getPosition(this.props.flycam);
          const id = getIdForPos(pos);
          if (id === 0) {
            Toast.info("No cell found at centered position");
          }
          this.props.changeActiveIsosurfaceId(id, pos, true);
        }}
        disabled={!hasSegmentation}
        size="small"
      >
        Compute Mesh
      </Button>
    );

    const loadPrecomputedMesh = async () => {
      const pos = getPosition(this.props.flycam);
      const id = getIdForPos(pos);
      if (id === 0) {
        Toast.info("No cell found at centered position");
        return;
      }
      if (!this.props.currentMeshFile || !this.props.segmentationLayer) {
        return;
      }
      await loadMeshFromFile(
        id,
        pos,
        this.props.currentMeshFile,
        this.props.segmentationLayer,
        this.props.dataset,
      );
    };

    const handleMeshFileSelected = async mesh => {
      if (mesh.key === "refresh") {
        maybeFetchMeshFiles(this.props.segmentationLayer, this.props.dataset, true);
      } else {
        this.props.setCurrentMeshFile(mesh.key);
        loadPrecomputedMesh();
      }
    };

    const getMeshFilesDropdown = () => (
      <Menu onClick={handleMeshFileSelected}>
        <MenuItem key="refresh" icon={<ReloadOutlined />}>
          Reload from Server.
        </MenuItem>
        {this.props.availableMeshFiles ? (
          this.props.availableMeshFiles.map(meshFile => (
            <Menu.Item key={meshFile} value={meshFile}>
              {meshFile}
            </Menu.Item>
          ))
        ) : (
          <MenuItem key="no files" disabled>
            No files available.
          </MenuItem>
        )}
      </Menu>
    );

    const getLoadPrecomputedMeshButton = () => {
      const hasCurrentMeshFile = this.props.currentMeshFile;
      return (
        <Tooltip
          key="tooltip"
          title={
            this.props.currentMeshFile != null
              ? `Load mesh for centered cell from file ${this.props.currentMeshFile}`
              : "There is no mesh file."
          }
        >
          <DropdownButton
            size="small"
            trigger="click"
            onClick={loadPrecomputedMesh}
            overlay={getMeshFilesDropdown()}
            buttonsRender={([leftButton, rightButton]) => [
              React.cloneElement(leftButton, {
                disabled: !hasCurrentMeshFile,
                style: { borderRightStyle: "dashed" },
              }),
              React.cloneElement(rightButton, { style: { borderLeftStyle: "dashed" } }),
            ]}
          >
            Load Precomputed Mesh
          </DropdownButton>
        </Tooltip>
      );
    };

    const getHeaderDropdownMenu = () => (
      <Menu>
        <Menu.Item onClick={startComputingMeshfile} disabled={!features().jobsEnabled}>
          {getComputeMeshfileTooltip("Compute Mesh File")}
        </Menu.Item>
        <Menu.Item>{getStlImportItem()}</Menu.Item>
      </Menu>
    );

    const getHeaderDropdownButton = () => (
      <Dropdown overlay={getHeaderDropdownMenu()}>
        <EllipsisOutlined />
      </Dropdown>
    );

    const getMeshesHeader = () => (
      <React.Fragment>
        Meshes{" "}
        <Tooltip title="Meshes are rendered alongside the actual data in the 3D viewport. They can be computed ad-hoc or pre-computed.">
          <InfoCircleOutlined />
        </Tooltip>
        {getHeaderDropdownButton()}
        <div className="antd-legacy-group">
          {getLoadMeshCellButton()}
          {this.props.currentMeshFile ? getLoadPrecomputedMeshButton() : getComputeMeshFileButton()}
        </div>
      </React.Fragment>
    );
    const getToggleVisibilityCheckbox = (segmentId: number, isVisible: boolean) => (
      <Tooltip title="Change visibility">
        <Checkbox
          checked={isVisible}
          onChange={(event: SyntheticInputEvent<>) => {
            this.props.onChangeVisibility(segmentId, event.target.checked);
          }}
        />
      </Tooltip>
    );

    const getIsosurfaceListItem = (isosurface: IsosurfaceInformation) => {
      const { segmentId, seedPosition, isLoading, isPrecomputed, isVisible } = isosurface;
      const isCenteredCell = hasSegmentation ? getIdForPos(getPosition(this.props.flycam)) : false;
      const isHoveredItem = segmentId === this.state.hoveredListItem;
      const actionVisibility = isLoading || isHoveredItem ? "visible" : "hidden";

      const textStyle = isVisible ? {} : { fontStyle: "italic", color: "#989898" };
      return (
        <List.Item
          style={{
            padding: 0,
            cursor: "pointer",
          }}
          onMouseEnter={() => {
            this.setState({ hoveredListItem: segmentId });
          }}
          onMouseLeave={() => {
            this.setState({ hoveredListItem: null });
          }}
          key={segmentId}
        >
          <div style={{ display: "flex" }}>
            <div
              className={classnames("isosurface-list-item", {
                "is-centered-cell": segmentId === isCenteredCell,
              })}
            >
              {isHoveredItem ? (
                getToggleVisibilityCheckbox(segmentId, isVisible)
              ) : (
                <span
                  className="circle"
                  style={{
                    paddingLeft: "10px",
                    backgroundColor: convertCellIdToCSS(segmentId),
                  }}
                />
              )}{" "}
              <span
                onClick={() => {
                  this.props.changeActiveIsosurfaceId(segmentId, seedPosition, !isPrecomputed);
                  moveTo(seedPosition);
                }}
                style={textStyle}
              >
                Segment {segmentId}
              </span>
            </div>
            <div style={{ visibility: actionVisibility, marginLeft: 6 }}>
              {getRefreshButton(segmentId, isPrecomputed, isLoading)}
              {getDownloadButton(segmentId)}
              {getDeleteButton(segmentId)}
            </div>
          </div>
        </List.Item>
      );
    };

    const getIsosurfaceList = () =>
      // $FlowIgnore[incompatible-call] flow does not know that the values passed as isosurfaces are indeed from the type IsosurfaceInformation
      Object.values(this.props.isosurfaces).map(isosurface => getIsosurfaceListItem(isosurface));

    return (
      <div className="padded-tab-content">
        {getMeshesHeader()}
        <List
          size="small"
          split={false}
          style={{ marginTop: 12 }}
          locale={{
            emptyText: `There are no Meshes.${
              this.props.allowUpdate
                ? " You can render a mesh for the currently centered cell by clicking the button above."
                : ""
            }`,
          }}
        >
          {getIsosurfaceList()}
        </List>
      </div>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(MeshesView);
