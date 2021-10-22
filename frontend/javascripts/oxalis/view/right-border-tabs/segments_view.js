// @flow
import { Button, List, Tooltip, Dropdown, Menu } from "antd";
import {
  DeleteOutlined,
  LoadingOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
  EllipsisOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect, useDispatch } from "react-redux";
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

const convertCellIdToCSS = (id: number, mappingColors) => {
  const [h, s, l, a] = jsConvertCellIdToHSLA(id, mappingColors);
  return `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
};

// This file defines the component SegmentsView.

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

  loadPrecomputedMeshForIdAndPosition = async (id: number, pos: Vector3) => {
    if (id === 0) {
      Toast.info("No segment found at centered position");
      return;
    }
    const { dataset, currentMeshFile, visibleSegmentationLayer } = this.props;
    if (!currentMeshFile || !visibleSegmentationLayer) {
      return;
    }
    await loadMeshFromFile(id, pos, currentMeshFile, visibleSegmentationLayer, dataset);
  };

  loadPrecomputedMeshForCentered = (flycam: Flycam) => {
    const pos = getPosition(flycam);
    const id = getSegmentIdForPosition(pos);
    return this.loadPrecomputedMeshForIdAndPosition(id, pos);
  };

  loadPrecomputedMeshForSegment = (segment: Segment) => {
    const pos = segment.somePosition;
    const id = segment.id;
    return this.loadPrecomputedMeshForIdAndPosition(id, pos);
  };

  getComputeMeshAdHocHeaderButton = () => {
    const { disabled, title } = getComputeMeshAdHocTooltipInfo(
      true,
      this.props.visibleSegmentationLayer != null,
    );
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
        this.loadPrecomputedMeshForCentered(this.props.flycam);
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
            onClick={this.loadPrecomputedMeshForCentered}
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
          this.props.currentMeshFile ? null : this.getComputeMeshAdHocHeaderButton()}
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
            emptyText: `There are no segments yet.${
              this.props.allowUpdate
                ? " Use the volume tools (e.g., the brush) to create a segment. Alternatively, select or hover existing segments to add them to this list."
                : "Select or hover existing segments to add them to this list."
            }`,
          }}
        >
          {allSegments.map(segment => (
            <SegmentListItem
              key={segment.id}
              segment={segment}
              centeredSegmentId={centeredSegmentId}
              loadPrecomputedMeshForSegment={this.loadPrecomputedMeshForSegment}
              selectedSegmentId={this.state.selectedSegmentId}
              activeDropdownSegmentId={this.state.activeDropdownSegmentId}
              onSelectSegment={this.onSelectSegment}
              handleSegmentDropdownMenuVisibility={this.handleSegmentDropdownMenuVisibility}
              isosurface={this.props.isosurfaces[segment.id]}
              {...this.props}
            />
          ))}
        </List>
      </div>
    );
  }
}

const getLoadPrecomputedMeshMenuItem = (
  segment: Segment,
  currentMeshFile,
  loadPrecomputedMeshForSegment,
) => {
  const hasCurrentMeshFile = currentMeshFile != null;

  return (
    <Menu.Item
      onClick={() => loadPrecomputedMeshForSegment(segment)}
      disabled={!hasCurrentMeshFile}
    >
      <Tooltip
        key="tooltip"
        title={
          currentMeshFile != null
            ? `Load mesh for centered segment from file ${currentMeshFile}`
            : "There is no mesh file."
        }
      >
        Load Mesh (precomputed)
      </Tooltip>
    </Menu.Item>
  );
};

const getComputeMeshAdHocMenuItem = (
  segment: Segment,
  changeActiveIsosurfaceId,
  isSegmentationLayerVisible: boolean,
) => {
  const { disabled, title } = getComputeMeshAdHocTooltipInfo(false, isSegmentationLayerVisible);
  return (
    <Menu.Item
      onClick={() => {
        changeActiveIsosurfaceId(segment.id, segment.somePosition, true);
      }}
      disabled={disabled}
    >
      <Tooltip title={title}>Compute Mesh (ad hoc)</Tooltip>
    </Menu.Item>
  );
};

function SegmentListItem({
  segment,
  mappingColors,
  hoveredSegmentId,
  centeredSegmentId,
  selectedSegmentId,
  activeCellId,
  setHoveredSegmentId,
  handleSegmentDropdownMenuVisibility,
  activeDropdownSegmentId,
  allowUpdate,
  updateSegment,
  onSelectSegment,
  visibleSegmentationLayer,
  changeActiveIsosurfaceId,
  isosurface,
  setPosition,
  loadPrecomputedMeshForSegment,
  currentMeshFile,
}: {
  segment: Segment,
  mappingColors: ?Array<number>,
  hoveredSegmentId: ?number,
  centeredSegmentId: ?number,
  selectedSegmentId: ?number,
  activeCellId: ?number,
  setHoveredSegmentId: (?number) => void,
  handleSegmentDropdownMenuVisibility: (number, boolean) => void,
  activeDropdownSegmentId: ?number,
  allowUpdate: boolean,
  updateSegment: (number, $Shape<Segment>) => void,
  onSelectSegment: Segment => void,
  visibleSegmentationLayer: ?APISegmentationLayer,
  changeActiveIsosurfaceId: (?number, Vector3, boolean) => void,
  isosurface: ?IsosurfaceInformation,
  setPosition: (Vector3, boolean) => void,
  loadPrecomputedMeshForSegment: Segment => Promise<void>,
  currentMeshFile: ?string,
}) {
  const createSegmentContextMenu = () => (
    <Menu>
      {getLoadPrecomputedMeshMenuItem(segment, currentMeshFile, loadPrecomputedMeshForSegment)}
      {getComputeMeshAdHocMenuItem(
        segment,
        changeActiveIsosurfaceId,
        visibleSegmentationLayer != null,
      )}
    </Menu>
  );

  return (
    <List.Item
      style={{ padding: "2px 5px" }}
      className={classnames("segment-list-item", {
        "is-selected-cell": segment.id === selectedSegmentId,
        "is-hovered-cell": segment.id === hoveredSegmentId,
      })}
      onMouseEnter={() => {
        setHoveredSegmentId(segment.id);
      }}
      onMouseLeave={() => {
        setHoveredSegmentId(null);
      }}
    >
      {getColoredDotIconForSegment(segment.id, mappingColors)}

      <Dropdown
        overlay={createSegmentContextMenu}
        // Destroy the menu after it was closed so that createSegmentContextMenu is only called
        // when it's really needed.
        // destroyPopupOnHide does not work properly. See https://github.com/react-component/trigger/issues/106#issuecomment-948532990
        autoDestroy
        placement="bottomCenter"
        visible={activeDropdownSegmentId === segment.id}
        onVisibleChange={isVisible => handleSegmentDropdownMenuVisibility(segment.id, isVisible)}
        trigger={["contextMenu"]}
      >
        <EditableTextLabel
          value={segment.name || `Segment ${segment.id}`}
          label="Segment Name"
          onClick={() => onSelectSegment(segment)}
          onChange={name => updateSegment(segment.id, { name })}
          horizontalMargin={5}
          disableEditing={!allowUpdate}
        />
      </Dropdown>
      <Tooltip title="Open context menu (also available via right-click)">
        <EllipsisOutlined onClick={() => handleSegmentDropdownMenuVisibility(segment.id, true)} />
      </Tooltip>
      {/* Show Default Segment Name if another one is already defined*/}
      {segment.name != null ? (
        <Tooltip title="Segment ID">
          <span className="deemphasized-segment-name">{segment.id}</span>
        </Tooltip>
      ) : null}
      {segment.id === centeredSegmentId ? (
        <Tooltip title="This segment is currently centered in the data viewports.">
          <i className="fas fa-crosshairs deemphasized-segment-name" style={{ marginLeft: 4 }} />
        </Tooltip>
      ) : null}
      {segment.id === activeCellId ? (
        <Tooltip title="The currently active segment id belongs to this segment.">
          <i className="fas fa-paint-brush deemphasized-segment-name" style={{ marginLeft: 4 }} />
        </Tooltip>
      ) : null}

      <div style={{ marginLeft: 16 }}>
        <MeshInfoItem
          segment={segment}
          isSelectedInList={segment.id === selectedSegmentId}
          isHovered={segment.id === hoveredSegmentId}
          isosurface={isosurface}
          handleSegmentDropdownMenuVisibility={handleSegmentDropdownMenuVisibility}
          changeActiveIsosurfaceId={changeActiveIsosurfaceId}
          visibleSegmentationLayer={visibleSegmentationLayer}
          setPosition={setPosition}
        />
      </div>
    </List.Item>
  );
}

function MeshInfoItem(props: {
  segment: Segment,
  isSelectedInList: boolean,
  isHovered: boolean,
  isosurface: ?IsosurfaceInformation,
  handleSegmentDropdownMenuVisibility: (number, boolean) => void,
  visibleSegmentationLayer: ?APISegmentationLayer,
  changeActiveIsosurfaceId: (?number, Vector3, boolean) => void,
  setPosition: (Vector3, boolean) => void,
}) {
  const dispatch = useDispatch();
  const onChangeMeshVisibility = (layerName: string, id: number, isVisible: boolean) => {
    dispatch(updateIsosurfaceVisibilityAction(layerName, id, isVisible));
  };

  const { segment, isSelectedInList, isHovered, isosurface } = props;
  const deemphasizedStyle = { fontStyle: "italic", color: "#989898" };
  if (!isosurface) {
    if (isSelectedInList) {
      return (
        <div
          style={{ ...deemphasizedStyle, marginLeft: 8 }}
          onContextMenu={evt => {
            evt.preventDefault();
            props.handleSegmentDropdownMenuVisibility(segment.id, true);
          }}
        >
          No mesh loaded. Use the context menu to do generate one.
        </div>
      );
    }
    return null;
  }
  const { seedPosition, isLoading, isPrecomputed, isVisible } = isosurface;
  const textStyle = isVisible ? {} : deemphasizedStyle;

  const downloadButton = (
    <Tooltip title="Download Mesh">
      <VerticalAlignBottomOutlined
        key="download-button"
        onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segment.id))}
      />
    </Tooltip>
  );

  const deleteButton = (
    <Tooltip title="Delete Mesh">
      <DeleteOutlined
        key="delete-button"
        onClick={() => {
          if (!props.visibleSegmentationLayer) {
            return;
          }
          Store.dispatch(removeIsosurfaceAction(props.visibleSegmentationLayer.name, segment.id));
          // reset the active mesh id so the deleted one is not reloaded immediately
          props.changeActiveIsosurfaceId(0, [0, 0, 0], false);
        }}
      />
    </Tooltip>
  );

  const toggleVisibilityCheckbox = (
    <Tooltip title="Change visibility">
      <Checkbox
        checked={isVisible}
        onChange={(event: SyntheticInputEvent<>) => {
          if (!props.visibleSegmentationLayer) {
            return;
          }
          onChangeMeshVisibility(
            props.visibleSegmentationLayer.name,
            segment.id,
            event.target.checked,
          );
        }}
      />
    </Tooltip>
  );

  const actionVisibility = isLoading || isHovered ? "visible" : "hidden";

  return (
    <List.Item
      style={{
        padding: 0,
        cursor: "pointer",
      }}
      key={segment.id}
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
              props.changeActiveIsosurfaceId(segment.id, seedPosition, !isPrecomputed);
              props.setPosition(seedPosition, false);
            }}
            style={{ ...textStyle, marginLeft: 8 }}
          >
            {isPrecomputed ? "Mesh (precomputed)" : "Mesh (ad-hoc computed)"}
          </span>
        </div>
        <div style={{ visibility: actionVisibility, marginLeft: 6 }}>
          {getRefreshButton(segment, isPrecomputed, isLoading, props.visibleSegmentationLayer)}
          {downloadButton}
          {deleteButton}
        </div>
      </div>
    </List.Item>
  );
}

function getColoredDotIconForSegment(segmentId: number, mappingColors) {
  return (
    <span
      className="circle"
      style={{
        paddingLeft: "10px",
        backgroundColor: convertCellIdToCSS(segmentId, mappingColors),
      }}
    />
  );
}

function getComputeMeshAdHocTooltipInfo(
  isForCenteredSegment: boolean,
  isSegmentationLayerVisible: boolean,
) {
  let title = "";
  let disabled = true;
  if (!isSegmentationLayerVisible) {
    title = "There is no visible segmentation layer for which a mesh could be computed.";
  } else {
    title = `Compute mesh for ${isForCenteredSegment ? "the centered" : "this"} segment.`;
    disabled = false;
  }

  return {
    disabled,
    title,
  };
}

function getRefreshButton(
  segment: Segment,
  isPrecomputed: boolean,
  isLoading: boolean,
  visibleSegmentationLayer: ?APISegmentationLayer,
) {
  if (isLoading) {
    return (
      <LoadingOutlined
        key="refresh-button"
        onClick={() => {
          if (!visibleSegmentationLayer) {
            return;
          }
          Store.dispatch(refreshIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
        }}
      />
    );
  } else {
    return isPrecomputed ? null : (
      <Tooltip title="Refresh Mesh">
        <ReloadOutlined
          key="refresh-button"
          onClick={() => {
            if (!visibleSegmentationLayer) {
              return;
            }
            Store.dispatch(refreshIsosurfaceAction(visibleSegmentationLayer.name, segment.id));
          }}
        />
      </Tooltip>
    );
  }
}

export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(SegmentsView);
