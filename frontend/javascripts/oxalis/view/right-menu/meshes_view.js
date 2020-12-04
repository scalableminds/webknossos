// @flow

import { Button, Checkbox, Icon, Input, List, Modal, Spin, Tooltip, Upload } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { ExtractReturn } from "libs/type_helpers";
import type { MeshMetaData, RemoteMeshMetaData } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import Store from "oxalis/store";
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
import { setPositionAction } from "oxalis/model/actions/flycam_actions";
import { isIsosurfaceStl } from "oxalis/model/sagas/isosurface_saga";
import { readFileAsArrayBuffer } from "libs/read_file";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import ButtonComponent from "oxalis/view/components/button_component";
import { SwitchSetting } from "oxalis/view/settings/setting_input_views";
import { trackAction } from "oxalis/model/helpers/analytics";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
const ButtonGroup = Button.Group;

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
  isHybrid: state.tracing.volume != null && state.tracing.skeleton != null,
  isosurfaces: state.isosurfaces,
  datasetConfiguration: state.datasetConfiguration,
  mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
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
});

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  meshes: Array<MeshMetaData>,
  isImporting: boolean,
  isHybrid: true,
|};
type DispatchProps = ExtractReturn<typeof mapDispatchToProps>;

type Props = { ...OwnProps, ...DispatchProps, ...StateProps };

const getCheckboxStyle = isLoaded =>
  isLoaded
    ? {}
    : {
        fontStyle: "italic",
        color: "#989898",
      };

class MeshesView extends React.Component<
  Props,
  { currentlyEditedMesh: ?MeshMetaData, activeCellId: ?number, hoveredListItem: ?number },
> {
  state = {
    currentlyEditedMesh: null,
    activeCellId: null,
    hoveredListItem: null,
  };

  render() {
    const moveToIsosurface = (seedPosition: Vector3) => {
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
          onClick={() => Store.dispatch(removeIsosurfaceAction(segmentId))}
        />
      </Tooltip>
    );
    const convertHSLAToCSSString = ([h, s, l, a]) =>
      `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
    const convertCellIdToCSS = id =>
      convertHSLAToCSSString(jsConvertCellIdToHSLA(id, this.props.mappingColors));

    const renderListItem = (isosurface: Object) => {
      const { segmentId, seedPosition, isLoading } = isosurface;
      const isActiveCell = segmentId === this.state.activeCellId;
      const visibility = segmentId === this.state.hoveredListItem ? "visible" : "hidden";
      return (
        <List.Item
          actions={[
            <div key="actions" style={{ visibility }}>
              {getDownloadButton(segmentId)}
              {getRefreshButton(segmentId, isLoading)}
              {getDeleteButton(segmentId)}
            </div>,
          ]}
          style={{
            padding: 0,
            backgroundColor: isActiveCell ? "#91d5ff" : "white",
            cursor: "pointer",
          }}
          onMouseEnter={() => {
            this.setState({ hoveredListItem: segmentId });
          }}
          onMouseLeave={() => {
            this.setState({ hoveredListItem: null });
          }}
          onClick={() => {
            moveToIsosurface(seedPosition);
            this.setState({ activeCellId: segmentId });
          }}
        >
          <div style={{ paddingLeft: 5 }}>
            <span
              className="circle"
              style={{
                paddingLeft: "10px",
                backgroundColor: convertCellIdToCSS(segmentId),
              }}
            />{" "}
            Segment {segmentId}
          </div>
        </List.Item>
      );
    };

    return (
      <div className="padded-tab-content">
        <ButtonGroup style={{ marginBottom: 12 }}>
          <Upload
            accept=".stl"
            beforeUpload={() => false}
            onChange={file => {
              this.props.onStlUpload(file);
            }}
            showUploadList={false}
          >
            <ButtonComponent
              title="Import STL Mesh"
              loading={this.props.isImporting}
              faIcon="fas fa-plus"
            >
              Import
            </ButtonComponent>
          </Upload>
          {this.props.isHybrid ? null : (
            <Tooltip title="Download the isosurface of the currently active cell as STL.">
              <ButtonComponent icon="download" onClick={this.props.downloadIsosurface}>
                Download
              </ButtonComponent>
            </Tooltip>
          )}
        </ButtonGroup>
        <SwitchSetting
          label="Isosurfaces "
          value={this.props.datasetConfiguration.renderIsosurfaces}
          onChange={_.partial(this.props.onChangeDatasetSettings, "renderIsosurfaces")}
        />
        {this.props.datasetConfiguration.renderIsosurfaces && (
          <List
            dataSource={Object.values(this.props.isosurfaces)}
            size="small"
            split={false}
            renderItem={renderListItem}
            locale={{
              emptyText:
                "There are no Isosurfaces. You can render one by holding shift and left clicking on a cell.",
            }}
          />
        )}
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

        {this.props.meshes.map(mesh => {
          // Coerce nullable isLoading to a proper boolean
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
        })}
      </div>
    );
  }
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(MeshesView);
