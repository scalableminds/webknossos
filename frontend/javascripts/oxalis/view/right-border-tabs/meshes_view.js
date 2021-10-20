// @flow
import { Button, List, Tooltip, Dropdown, Menu } from "antd";
import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import Toast from "libs/toast";
import type { ExtractReturn } from "libs/type_helpers";
import EditableTextLabel from "oxalis/view/components/editable_text_label";

import type { APISegmentationLayer, APIUser, APIDataset } from "types/api_flow_types";
import type { OxalisState, Flycam, IsosurfaceInformation, Segment, SegmentMap } from "oxalis/store";
import Store from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import {
  createMeshFromBufferAction,
  deleteMeshAction,
  importIsosurfaceFromStlAction,
  triggerActiveIsosurfaceDownloadAction,
  triggerIsosurfaceDownloadAction,
  updateIsosurfaceVisibilityAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import features from "features";
import {
  loadMeshFromFile,
  maybeFetchMeshFiles,
  getBaseSegmentationName,
} from "oxalis/view/right-border-tabs/meshes_view_helper";
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

// Interval in ms to check for running mesh file computation jobs for this dataset
const refreshInterval = 5000;
const defaultMeshfileGenerationResolutionIndex = 2;

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111], // ASCII codes for ISO
  cellIdIndex: 3, // Write cell index after the isosurfaceMarker
};

// This file defines the component MeshesView.

type StateProps = {|
  isosurfaces: { [segmentId: number]: IsosurfaceInformation },
  dataset: APIDataset,
  mappingColors: ?Array<number>,
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
|};

const mapStateToProps = (state: OxalisState): StateProps => {
  const visibleSegmentationLayer = getVisibleSegmentationLayer(state);
  return {
    activeCellId: state.tracing.volume != null ? state.tracing.volume.activeCellId : null,
    isosurfaces:
      visibleSegmentationLayer != null
        ? state.localSegmentationData[visibleSegmentationLayer.name].isosurfaces
        : {},
    dataset: state.dataset,
    mappingColors: getMappingInfo(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer != null ? visibleSegmentationLayer.name : null,
    ).mappingColors,
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
  };
};

const mapDispatchToProps = (dispatch: Dispatch<*>): * => ({
  onChangeDatasetSettings(propertyName, value) {
    dispatch(updateDatasetSettingAction(propertyName, value));
  },
  deleteMesh(id: string) {
    dispatch(deleteMeshAction(id));
  },
  onChangeVisibility(layerName: string, id: number, isVisible: boolean) {
    dispatch(updateIsosurfaceVisibilityAction(layerName, id, isVisible));
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
  setPosition(position: Vector3, dimensionToSkip: ?number, shouldRefreshIsosurface?: boolean) {
    dispatch(setPositionAction(position, dimensionToSkip, shouldRefreshIsosurface));
  },
  updateSegment(segmentId: number, segmentShape: $Shape<Segment>) {
    dispatch(updateSegmentAction(segmentId, segmentShape));
  },
});

type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = {| ...DispatchProps, ...StateProps |};

type State = { selectedSegmentId: ?number, activeMeshJobId: ?string };

class MeshesView extends React.Component<Props, State> {
  intervalID: ?TimeoutID;

  state = {
    selectedSegmentId: null,
    activeMeshJobId: null,
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
            'The computation of a mesh file for this dataset has finished. You can now use the "Load Precomputed Mesh" functionality in the "Meshes" tab.',
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

  convertCellIdToCSS = (id: number) => {
    const [h, s, l, a] = jsConvertCellIdToHSLA(id, this.props.mappingColors);
    return `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
  };

  getComputeMeshAdHocTooltipInfo = () => {
    let title = "";
    let disabled = true;
    if (this.props.visibleSegmentationLayer == null) {
      title = "There is no segmentation layer for which a mesh could be computed.";
    } else {
      title = "Compute mesh for the centered segment.";
      disabled = false;
    }

    return {
      disabled,
      title,
    };
  };

  getMeshInfo = (segmentId: number, isSelectedInList: boolean, isHovered: boolean) => {
    if (!this.props.isosurfaces[segmentId]) {
      if (isSelectedInList) {
        return (
          <div>
            <div>{this.getLoadPrecomputedMeshLinkButton()}</div>
            <div>{this.getComputeMeshAdHocLinkButton()}</div>
          </div>
        );
      }
      return null;
    }
    const moveTo = (seedPosition: Vector3) => {
      this.props.setPosition(seedPosition, null, false);
    };

    const downloadButton = (
      <Tooltip title="Download Mesh">
        <VerticalAlignBottomOutlined
          key="download-button"
          onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segmentId))}
        />
      </Tooltip>
    );
    const getRefreshButton = (isPrecomputed: boolean, isLoading: boolean) => {
      if (isLoading) {
        return (
          <LoadingOutlined
            key="refresh-button"
            onClick={() => {
              if (!this.props.visibleSegmentationLayer) {
                return;
              }
              Store.dispatch(
                refreshIsosurfaceAction(this.props.visibleSegmentationLayer.name, segmentId),
              );
            }}
          />
        );
      } else {
        return isPrecomputed ? null : (
          <Tooltip title="Refresh Mesh">
            <ReloadOutlined
              key="refresh-button"
              onClick={() => {
                if (!this.props.visibleSegmentationLayer) {
                  return;
                }
                Store.dispatch(
                  refreshIsosurfaceAction(this.props.visibleSegmentationLayer.name, segmentId),
                );
              }}
            />
          </Tooltip>
        );
      }
    };
    const deleteButton = (
      <Tooltip title="Delete Mesh">
        <DeleteOutlined
          key="delete-button"
          onClick={() => {
            if (!this.props.visibleSegmentationLayer) {
              return;
            }
            Store.dispatch(
              removeIsosurfaceAction(this.props.visibleSegmentationLayer.name, segmentId),
            );
            // reset the active mesh id so the deleted one is not reloaded immediately
            this.props.changeActiveIsosurfaceId(0, [0, 0, 0], false);
          }}
        />
      </Tooltip>
    );

    const isosurface = this.props.isosurfaces[segmentId];
    const { seedPosition, isLoading, isPrecomputed, isVisible } = isosurface;

    const toggleVisibilityCheckbox = (
      <Tooltip title="Change visibility">
        <Checkbox
          checked={isVisible}
          onChange={(event: SyntheticInputEvent<>) => {
            if (!this.props.visibleSegmentationLayer) {
              return;
            }
            this.props.onChangeVisibility(
              this.props.visibleSegmentationLayer.name,
              segmentId,
              event.target.checked,
            );
          }}
        />
      </Tooltip>
    );

    const actionVisibility = isLoading || isHovered ? "visible" : "hidden";

    const textStyle = isVisible ? {} : { fontStyle: "italic", color: "#989898" };
    return (
      <List.Item
        style={{
          padding: 0,
          cursor: "pointer",
        }}
        key={segmentId}
      >
        <div style={{ display: "flex" }}>
          <div
            className={classnames("segment-list-item", {
              "is-selected-cell": isSelectedInList,
            })}
          >
            {toggleVisibilityCheckbox}
            <span
              onClick={() => {
                this.props.changeActiveIsosurfaceId(segmentId, seedPosition, !isPrecomputed);
                moveTo(seedPosition);
              }}
              style={{ ...textStyle, marginLeft: 8 }}
            >
              {isPrecomputed ? "Mesh (precomputed)" : "Mesh (ad-hoc computed)"}
            </span>
          </div>
          <div style={{ visibility: actionVisibility, marginLeft: 6 }}>
            {getRefreshButton(isPrecomputed, isLoading)}
            {downloadButton}
            {deleteButton}
          </div>
        </div>
      </List.Item>
    );
  };

  getColoredDotIconForSegment = (segmentId: number) => (
    <span
      className="circle"
      style={{
        paddingLeft: "10px",
        backgroundColor: this.convertCellIdToCSS(segmentId),
      }}
    />
  );

  getComputeMeshAdHocButton = () => {
    const { disabled, title } = this.getComputeMeshAdHocTooltipInfo();
    return (
      <Tooltip title={title}>
        <Button
          onClick={() => {
            const pos = getPosition(this.props.flycam);
            const id = getSegmentIdForPosition(pos);
            if (id === 0) {
              Toast.info("No segment found at centered position");
            }
            this.props.changeActiveIsosurfaceId(id, pos, true);
          }}
          disabled={disabled}
          size="small"
        >
          Compute Mesh (ad hoc)
        </Button>
      </Tooltip>
    );
  };

  getComputeMeshAdHocLinkButton = () => {
    const { disabled, title } = this.getComputeMeshAdHocTooltipInfo();
    return (
      <Tooltip title={title}>
        <Button
          type="link"
          onClick={() => {
            const pos = getPosition(this.props.flycam);
            const id = getSegmentIdForPosition(pos);
            if (id === 0) {
              Toast.info("No segment found at centered position");
            }
            this.props.changeActiveIsosurfaceId(id, pos, true);
          }}
          disabled={disabled}
          size="small"
        >
          Compute Mesh (ad hoc)
        </Button>
      </Tooltip>
    );
  };

  getLoadPrecomputedMeshLinkButton = () => {
    const hasCurrentMeshFile = this.props.currentMeshFile;
    if (!hasCurrentMeshFile) {
      return null;
    }
    return (
      <Tooltip
        key="tooltip"
        title={
          this.props.currentMeshFile != null
            ? `Load mesh for centered segment from file ${this.props.currentMeshFile}`
            : "There is no mesh file."
        }
      >
        <Button size="small" onClick={this.loadPrecomputedMesh} type="link">
          Load Precomputed Mesh
        </Button>
      </Tooltip>
    );
  };

  loadPrecomputedMesh = async () => {
    const pos = getPosition(this.props.flycam);
    const id = getSegmentIdForPosition(pos);
    if (id === 0) {
      Toast.info("No segment found at centered position");
      return;
    }
    if (!this.props.currentMeshFile || !this.props.visibleSegmentationLayer) {
      return;
    }
    await loadMeshFromFile(
      id,
      pos,
      this.props.currentMeshFile,
      this.props.visibleSegmentationLayer,
      this.props.dataset,
    );
  };

  onSelectSegment = (segment: Segment) => {
    this.setState({ selectedSegmentId: segment.id });

    this.props.setPosition(segment.somePosition);
  };

  render() {
    const centeredSegmentId = getSegmentIdForPosition(getPosition(this.props.flycam));
    const startComputingMeshfile = async () => {
      const datasetResolutionInfo = getResolutionInfoOfVisibleSegmentationLayer(Store.getState());
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

    const getPrecomputeMeshesButton = () => {
      const { disabled, title } = this.getPrecomputeMeshesTooltipInfo();
      return (
        <Tooltip key="tooltip" title={title}>
          <Button
            size="small"
            loading={this.state.activeMeshJobId != null}
            onClick={startComputingMeshfile}
            disabled={disabled}
          >
            Precompute Meshes
          </Button>
        </Tooltip>
      );
    };

    const handleMeshFileSelected = async mesh => {
      if (mesh.key === "refresh") {
        maybeFetchMeshFiles(this.props.visibleSegmentationLayer, this.props.dataset, true);
      } else if (this.props.visibleSegmentationLayer != null) {
        this.props.setCurrentMeshFile(this.props.visibleSegmentationLayer.name, mesh.key);
        this.loadPrecomputedMesh();
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
              ? `Load mesh for centered segment from file ${this.props.currentMeshFile}`
              : "There is no mesh file."
          }
        >
          <DropdownButton
            size="small"
            trigger="click"
            onClick={this.loadPrecomputedMesh}
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

    const getMeshesHeader = () => (
      <React.Fragment>
        <div className="antd-legacy-group">
          {/* Only show option for ad-hoc computation if no mesh file is available */
          this.props.currentMeshFile ? null : this.getComputeMeshAdHocButton()}
          {this.props.currentMeshFile
            ? getLoadPrecomputedMeshButton()
            : getPrecomputeMeshesButton()}
        </div>
      </React.Fragment>
    );
    const allSegments = _.sortBy(
      this.props.segments ? Array.from(this.props.segments.values()) : [],
      "id",
    );
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
                ? " You can render a mesh for the currently centered segment by clicking the button above."
                : ""
            }`,
          }}
        >
          {allSegments.map(segment => (
            <List.Item
              key={segment.id}
              style={{ padding: "2px 5px" }}
              className={classnames("segment-list-item", {
                "is-selected-cell": segment.id === this.state.selectedSegmentId,
                "is-hovered-cell": segment.id === this.props.hoveredSegmentId,
              })}
              onClick={() => this.onSelectSegment(segment)}
              onMouseEnter={() => {
                this.props.setHoveredSegmentId(segment.id);
              }}
              onMouseLeave={() => {
                this.props.setHoveredSegmentId(null);
              }}
            >
              {this.getColoredDotIconForSegment(segment.id)}

              <EditableTextLabel
                value={segment.name || `Segment ${segment.id}`}
                label="Segment Name"
                onChange={newName => this.props.updateSegment(segment.id, { name: newName })}
                horizontalMargin={5}
              />
              {/* Show Default Segment Name if another one is already defined*/}
              {segment.name != null ? (
                <span className="deemphasized-segment-name">{segment.id}</span>
              ) : null}
              {segment.id === centeredSegmentId ? (
                <Tooltip title="This segment is currently centered in the data viewports.">
                  <i
                    className="fas fa-crosshairs deemphasized-segment-name"
                    style={{ marginLeft: 4 }}
                  />
                </Tooltip>
              ) : null}
              {segment.id === this.props.activeCellId ? (
                <Tooltip title="The currently active segment id belongs to this segment.">
                  <i
                    className="fas fa-paint-brush deemphasized-segment-name"
                    style={{ marginLeft: 4 }}
                  />
                </Tooltip>
              ) : null}

              <div style={{ marginLeft: 16 }}>
                {this.getMeshInfo(
                  segment.id,
                  segment.id === this.state.selectedSegmentId,
                  segment.id === this.props.hoveredSegmentId,
                )}
              </div>
            </List.Item>
          ))}
        </List>
      </div>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(MeshesView);
