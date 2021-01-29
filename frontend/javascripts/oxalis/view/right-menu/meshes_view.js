// @flow

import { Button, Checkbox, Icon, Input, List, Modal, Spin, Tooltip, Upload } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { ExtractReturn } from "libs/type_helpers";
import type { MeshMetaData, RemoteMeshMetaData } from "types/api_flow_types";
import type { OxalisState, IsosurfaceInformation } from "oxalis/store";
import Store from "oxalis/store";
import Model from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import { Vector3Input } from "libs/vector_input";
import {
  createMeshFromBufferAction,
  deleteMeshAction,
  importIsosurfaceFromStlAction,
  triggerActiveIsosurfaceDownloadAction,
  triggerIsosurfaceDownloadAction,
  updateLocalMeshMetaDataAction,
  updateRemoteMeshMetaDataAction,
  removeIsosurfaceAction,
  refreshIsosurfaceAction,
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

export const stlIsosurfaceConstants = {
  isosurfaceMarker: [105, 115, 111], // ASCII codes for ISO
  cellIdIndex: 3, // Write cell index after the isosurfaceMarker
};

// This file defines the components EditMeshModal and MeshesView.

class EditMeshModal extends React.PureComponent<
  {
    initialMesh: MeshMetaData,
    onOk: (string, string, Vector3) => void,
    onCancel: () => void,
  },
  { description: string, position: Vector3 },
> {
  state = {
    description: this.props.initialMesh.description,
    position: this.props.initialMesh.position,
  };

  render() {
    return (
      <Modal
        title="Edit Mesh Meta Data"
        visible
        onOk={() =>
          this.props.onOk(this.props.initialMesh.id, this.state.description, this.state.position)
        }
        onCancel={this.props.onCancel}
      >
        Description:{" "}
        <Input
          autoFocus
          value={this.state.description}
          onChange={evt => this.setState({ description: evt.target.value })}
        />
        Position:{" "}
        <Vector3Input
          value={this.state.position}
          onChange={position => this.setState({ position })}
        />
      </Modal>
    );
  }
}

const mapStateToProps = (state: OxalisState) => ({
  meshes: state.tracing != null ? state.tracing.meshes : [],
  isImporting: state.uiInformation.isImportingMesh,
  isosurfaces: state.isosurfaces,
  datasetConfiguration: state.datasetConfiguration,
  mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
  flycam: state.flycam,
  activeCellId: state.tracing.volume ? state.tracing.volume.activeCellId : null,
  segmentationLayer: getSegmentationLayer(state.dataset),
  zoomStep: getRequestLogZoomStep(state),
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
  changeActiveIsosurfaceId(cellId: ?number, seedPosition: Vector3) {
    if (cellId == null) return;
    dispatch(changeActiveIsosurfaceCellAction(cellId, seedPosition));
  },
});

type OwnProps = {|
  // eslint-disable-next-line react/no-unused-prop-types
  portalKey: string,
|};
type StateProps = {|
  meshes: Array<MeshMetaData>,
  isImporting: boolean,
|};
type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = {| ...OwnProps, ...DispatchProps, ...StateProps |};

const getCheckboxStyle = isLoaded =>
  isLoaded
    ? {}
    : {
        fontStyle: "italic",
        color: "#989898",
      };

class MeshesView extends React.Component<
  Props,
  { currentlyEditedMesh: ?MeshMetaData, hoveredListItem: ?number },
> {
  state = {
    currentlyEditedMesh: null,
    hoveredListItem: null,
  };

  render() {
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
        <Icon
          key="download-button"
          type="vertical-align-bottom"
          onClick={() => Store.dispatch(triggerIsosurfaceDownloadAction(segmentId))}
        />
      </Tooltip>
    );
    const getRefreshButton = (segmentId: number, isLoading: boolean) => (
      <Tooltip title="Refresh Isosurface">
        <Icon
          key="refresh-button"
          type={isLoading ? "loading" : "reload"}
          onClick={() => {
            Store.dispatch(refreshIsosurfaceAction(segmentId));
          }}
        />
      </Tooltip>
    );
    const getDeleteButton = (segmentId: number) => (
      <Tooltip title="Delete Isosurface">
        <Icon
          key="delete-button"
          type="delete"
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
          style={{ fontSize: 16, color: "#2a3a48", cursor: "pointer" }}
          disabled={this.props.isImporting}
        >
          <Tooltip
            title={this.props.isImporting ? "The import is still in progress." : "Import STL"}
          >
            <Icon type={this.props.isImporting ? "loading" : "plus-square"} />
          </Tooltip>
        </Upload>
      </React.Fragment>
    );
    const getLoadIsosurfaceCellButton = () => (
      <Button
        onClick={() => {
          const pos = getPosition(this.props.flycam);
          const id = getIdForPos(pos);
          this.props.changeActiveIsosurfaceId(id, pos);
        }}
        size="small"
        type="primary"
      >
        Load Isosurface for centered Cell
      </Button>
    );
    const getIsosurfacesHeader = () => (
      <React.Fragment>
        Isosurfaces{" "}
        <Tooltip title="Isosurfaces are the 3D representation of a cell. They are computed ad-hoc by webKnossos.">
          <Icon type="info-circle" />
        </Tooltip>
        {getImportButton()}
        {getLoadIsosurfaceCellButton()}
        <br />
      </React.Fragment>
    );
    const getMeshesHeader = () => (
      <div style={{ marginTop: 10 }}>
        Meshes{" "}
        <Tooltip title="Meshes are rendered alongside the actual data in the 3D viewport. They are imported from STL files.">
          <Icon type="info-circle" />
        </Tooltip>
        {getImportButton()}
      </div>
    );

    const renderIsosurfaceListItem = (isosurface: IsosurfaceInformation) => {
      const { segmentId, seedPosition, isLoading } = isosurface;
      const centeredCell = getIdForPos(getPosition(this.props.flycam));
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
        >
          <div style={{ display: "flex" }}>
            <div
              className="isosurface-list-item"
              style={{
                paddingLeft: 5,
                paddingRight: 5,
                backgroundColor: segmentId === centeredCell ? "#91d5ff" : "white",
                borderRadius: 2,
              }}
              onClick={() => {
                this.props.changeActiveIsosurfaceId(segmentId);
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
              {getRefreshButton(segmentId, isLoading)}
              {getDeleteButton(segmentId)}
            </div>
          </div>
        </List.Item>
      );
    };
    const renderMeshListItem = (mesh: Object) => {
      const isLoading = mesh.isLoading === true;
      return (
        <div key={mesh.id}>
          <Checkbox
            checked={mesh.isVisible}
            onChange={(event: SyntheticInputEvent<>) => {
              this.props.onChangeVisibility(mesh, event.target.checked);
            }}
            disabled={isLoading}
            style={getCheckboxStyle(mesh.isLoaded)}
          >
            {mesh.description}
          </Checkbox>
          {mesh.isLoaded ? (
            <React.Fragment>
              <Icon
                type="edit"
                onClick={() => this.setState({ currentlyEditedMesh: mesh })}
                style={{ cursor: "pointer" }}
              />
              <Icon
                type="delete"
                onClick={() => this.props.deleteMesh(mesh.id)}
                style={{ cursor: "pointer" }}
              />
            </React.Fragment>
          ) : null}
          <Spin size="small" spinning={isLoading} />
        </div>
      );
    };

    return (
      <div className="padded-tab-content">
        {getIsosurfacesHeader()}
        <List
          dataSource={Object.values(this.props.isosurfaces)}
          size="small"
          split={false}
          style={{ marginTop: 12 }}
          renderItem={renderIsosurfaceListItem}
          locale={{
            emptyText: "There are no Isosurfaces.",
          }}
        />
        {this.state.currentlyEditedMesh != null ? (
          <EditMeshModal
            initialMesh={this.state.currentlyEditedMesh}
            onOk={(id, description, position) => {
              this.props.updateRemoteMeshMetadata(id, { description, position });
              this.setState({ currentlyEditedMesh: null });
            }}
            onCancel={() => this.setState({ currentlyEditedMesh: null })}
          />
        ) : null}
        {getMeshesHeader()}
        <List
          dataSource={this.props.meshes}
          size="small"
          split={false}
          renderItem={renderMeshListItem}
          locale={{
            emptyText: "There are no meshes. You can import an STL file to change this. ",
          }}
        />
      </div>
    );
  }
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(MeshesView);
