// @flow
import { Button, List, Tooltip, Upload, Dropdown, Menu } from "antd";
import {
  DeleteOutlined,
  DownOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  PlusSquareOutlined,
  ReloadOutlined,
  UserOutlined,
  VerticalAlignBottomOutlined,
} from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import parseStlBuffer from "libs/parse_stl_buffer";
import Toast from "libs/toast";
import type { ExtractReturn } from "libs/type_helpers";
import type { MeshMetaData, RemoteMeshMetaData } from "types/api_flow_types";
import {
  getMeshfileChunksForSegment,
  getMeshfileChunkData,
  getMeshfilesForDatasetLayer,
} from "admin/admin_rest_api";
import type { OxalisState, IsosurfaceInformation } from "oxalis/store";
import Store from "oxalis/store";
import Model from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import {
  createMeshFromBufferAction,
  deleteMeshAction,
  importIsosurfaceFromStlAction,
  triggerActiveIsosurfaceDownloadAction,
  triggerIsosurfaceDownloadAction,
  updateLocalMeshMetaDataAction,
  updatePrecomMeshVisAction,
  updateRemoteMeshMetaDataAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
  addIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
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
  onChangeVisibility(mesh: MeshMetaData, isVisible: boolean) {
    dispatch(updateLocalMeshMetaDataAction(mesh.id, { isVisible }));
  },
  onChangePecompVisibility(id, isVisible: boolean) {
    dispatch(updatePrecomMeshVisAction(id, isVisible));
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
    if (cellId == null) return;
    dispatch(changeActiveIsosurfaceCellAction(cellId, seedPosition, shouldReload));
  },
  addPrecomputedMesh(cellId, seedPosition, fileName) {
    if (cellId == null) return;
    dispatch(addIsosurfaceAction(cellId, seedPosition, fileName));
  },
});

type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = {| ...DispatchProps |};

class MeshesView extends React.Component<
  Props,
  { hoveredListItem: ?number, meshFiles: Array<string>, currentMeshFile: string },
> {
  state = {
    hoveredListItem: null,
    meshFiles: [],
    currentMeshFile: "",
  };

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
      Store.dispatch(setPositionAction(seedPosition));
    };

    const getDownloadButton = (segmentId: number) => (
      <Tooltip title="Download Isosurface">
        <VerticalAlignBottomOutlined
          key="download-button"
          onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segmentId))}
        />
      </Tooltip>
    );
    const getRefreshButton = (segmentId: number, isLoading: boolean) => (
      <Tooltip title="Refresh Isosurface">
        {isLoading ? (
          <LoadingOutlined
            key="refresh-button"
            onClick={() => {
              Store.dispatch(refreshIsosurfaceAction(segmentId));
            }}
          />
        ) : (
          <ReloadOutlined
            key="refresh-button"
            onClick={() => {
              Store.dispatch(refreshIsosurfaceAction(segmentId));
            }}
          />
        )}
      </Tooltip>
    );
    const getDeleteButton = (segmentId: number) => (
      <Tooltip title="Delete Isosurface">
        <DeleteOutlined
          key="delete-button"
          onClick={() => {
            // does not work properly for imported isosurfaces
            Store.dispatch(removeIsosurfaceAction(segmentId));
            // reset the active isosurface id so the deleted one is not reloaded immediately
            this.props.changeActiveIsosurfaceId(0, [0, 0, 0]);
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

    const updateMeshFileList = async () => {
      const layerName =
        this.props.segmentationLayer.fallbackLayer || this.props.segmentationLayer.name;
      const availableMeshFiles = await getMeshfilesForDatasetLayer(
        this.props.dataset.dataStore.url,
        this.props.dataset,
        layerName,
      );
      this.setState({ meshFiles: availableMeshFiles });
    };

    const loadMeshFromFile = async fileName => {
      if (fileName === "") {
        Toast.error("Please select a mesh file.");
        return;
      }
      const pos = getPosition(this.props.flycam);
      const id = getIdForPos(pos);
      const layerName =
        this.props.segmentationLayer.fallbackLayer || this.props.segmentationLayer.name;
      const availableChunks = await getMeshfileChunksForSegment(
        this.props.dataset.dataStore.url,
        this.props.dataset,
        layerName,
        fileName,
        id,
      );
      for (const chunkPos of availableChunks) {
        // eslint-disable-next-line no-await-in-loop
        const stlData = await getMeshfileChunkData(
          this.props.dataset.dataStore.url,
          this.props.dataset,
          layerName,
          fileName,
          id,
          chunkPos,
        );
        const geometry = parseStlBuffer(stlData);
        getSceneController().addIsosurfaceFromGeometry(geometry, id);
      }
      this.props.addPrecomputedMesh(id, pos, fileName);
    };

    const handleMeshFileSelected = async mesh => {
      loadMeshFromFile(mesh.key);
      this.setState({ currentMeshFile: mesh.key });
    };

    const getMeshFilesDropdown = () => (
      <Menu onClick={handleMeshFileSelected}>
        {this.state.meshFiles.map(meshFile => (
          <Menu.Item
            key={meshFile}
            value={meshFile}
            disabled={this.state.currentMeshFile === meshFile}
          >
            {meshFile}
          </Menu.Item>
        ))}
      </Menu>
    );

    const getLoadPrecomputedMeshButton = () => (
      <DropdownButton
        size="small"
        onVisibleChange={updateMeshFileList}
        onClick={() => loadMeshFromFile(this.state.currentMeshFile)}
        overlay={getMeshFilesDropdown()}
        icon={<DownOutlined />}
        buttonsRender={([leftButton, rightButton]) => [
          <Tooltip
            key="tooltip"
            title={
              this.state.currentMeshFile
                ? `Load mesh for centered cell from file ${this.state.currentMeshFile}`
                : "Please select a mesh file first."
            }
          >
            {React.cloneElement(leftButton, {
              style: { borderRightStyle: "dashed" },
            })}
          </Tooltip>,
          React.cloneElement(rightButton, {
            style: { borderLeftStyle: "dashed" },
          }),
        ]}
      >
        Load from Meshfile
      </DropdownButton>
    );

    const getMeshesHeader = () => (
      <React.Fragment>
        Meshes{" "}
        <Tooltip title="Meshes are rendered alongside the actual data in the 3D viewport. They are imported from STL or hdf5 files. They can also be computed.">
          <InfoCircleOutlined />
        </Tooltip>
        {getImportButton()}
        <div className="antd-legacy-group">
          {getLoadMeshCellButton()}
          {getLoadPrecomputedMeshButton()}
        </div>
      </React.Fragment>
    );
    const getToggleVisButton = segmentId => (
      <Tooltip title="Change visibility">
        <UserOutlined
          key="vis-button"
          onClick={() => {
            this.props.onChangePecompVisibility(segmentId, false);
          }}
        />
      </Tooltip>
    );

    const getIsosurfaceListItem = (isosurface: IsosurfaceInformation) => {
      const { segmentId, seedPosition, isLoading, isPrecomputed } = isosurface;
      const isCenteredCell = hasSegmentation ? getIdForPos(getPosition(this.props.flycam)) : false;
      const actionVisibility =
        isLoading || segmentId === this.state.hoveredListItem ? "visible" : "hidden";
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
              onClick={() => {
                this.props.changeActiveIsosurfaceId(segmentId, !isPrecomputed);
                moveTo(seedPosition);
              }}
            >
              <span
                className="circle"
                style={{
                  paddingLeft: "10px",
                  backgroundColor: convertCellIdToCSS(segmentId),
                }}
              />{" "}
              Segment {segmentId}
            </div>
            <div style={{ visibility: actionVisibility, marginLeft: 6 }}>
              {getDownloadButton(segmentId)}
              {isPrecomputed
                ? getToggleVisButton(segmentId)
                : getRefreshButton(segmentId, isLoading)}
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
