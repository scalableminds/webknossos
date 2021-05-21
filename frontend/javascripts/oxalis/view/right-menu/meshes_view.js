// @flow
import { Button, List, Tooltip, Upload, Dropdown, Menu } from "antd";
import {
  DeleteOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusSquareOutlined,
  ReloadOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

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
import { loadMeshFromFile, maybeFetchMeshFiles } from "oxalis/view/right-menu/meshes_view_helper";
import { updateDatasetSettingAction } from "oxalis/model/actions/settings_actions";
import { changeActiveIsosurfaceCellAction } from "oxalis/model/actions/segmentation_actions";
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { isIsosurfaceStl } from "oxalis/model/sagas/isosurface_saga";
import { readFileAsArrayBuffer } from "libs/read_file";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import { trackAction } from "oxalis/model/helpers/analytics";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import classnames from "classnames";
import Checkbox from "antd/lib/checkbox/Checkbox";
import MenuItem from "antd/lib/menu/MenuItem";

// $FlowIgnore[prop-missing] flow does not know that Dropdown has a Button
const DropdownButton = Dropdown.Button;

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111], // ASCII codes for ISO
  cellIdIndex: 3, // Write cell index after the isosurfaceMarker
};

// This file defines the component MeshesView.

const mapStateToProps = (state: OxalisState) => ({
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
  availableMeshFiles: state.availableMeshFiles,
  currentMeshFile: state.currentMeshFile,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
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

type Props = {| ...DispatchProps |};

type State = { hoveredListItem: ?number };

class MeshesView extends React.Component<Props, State> {
  state = {
    hoveredListItem: null,
  };

  componentDidMount() {
    maybeFetchMeshFiles(this.props.segmentationLayer, this.props.dataset, false);
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
    const getIdForPos = pos => getSegmentationCube().getDataValue(pos, null, this.props.zoomStep);

    const moveTo = (seedPosition: Vector3) => {
      Store.dispatch(setPositionAction(seedPosition, null, false));
    };

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
            // does not work properly for imported isosurfaces
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

    const getImportButton = () => (
      <React.Fragment>
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
          <Tooltip
            title={this.props.isImporting ? "The import is still in progress." : "Import STL"}
          >
            {this.props.isImporting ? <LoadingOutlined /> : <PlusSquareOutlined />}
          </Tooltip>
        </Upload>
      </React.Fragment>
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
      const hasCurrenMeshFile = this.props.currentMeshFile;
      return (
        <Tooltip
          key="tooltip"
          title={
            hasCurrenMeshFile
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
                disabled: !hasCurrenMeshFile,
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
        Meshes{" "}
        <Tooltip title="Meshes are rendered alongside the actual data in the 3D viewport. They can be computed ad-hoc or pre-computed.">
          <InfoCircleOutlined />
        </Tooltip>
        {getImportButton()}
        <div className="antd-legacy-group">
          {getLoadMeshCellButton()}
          {getLoadPrecomputedMeshButton()}
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
