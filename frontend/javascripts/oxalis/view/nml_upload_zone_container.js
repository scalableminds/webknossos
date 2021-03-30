// @flow
import { Button, Modal, Avatar, List, Spin, Checkbox, Alert } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Dropzone from "react-dropzone";
import * as React from "react";
import prettyBytes from "pretty-bytes";
import type { Dispatch } from "redux";

import { navbarHeight } from "navbar";
import type { OxalisState } from "oxalis/store";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import FormattedDate from "components/formatted_date";
import { trackAction } from "oxalis/model/helpers/analytics";

type State = {
  files: Array<File>,
  dropzoneActive: boolean,
  isImporting: boolean,
  createGroupForEachFile: boolean,
  createGroupForSingleFile: boolean,
};

type OwnProps = {|
  children: React.Node,
  isUpdateAllowed: boolean,
  onImport: (files: Array<File>, createGroupForEachFile: boolean) => Promise<void>,
|};
type StateProps = {|
  showDropzoneModal: boolean,
  hideDropzoneModal: () => void,
|};
type Props = {| ...StateProps, ...OwnProps |};

function OverlayDropZone({ children }) {
  const overlayStyle = {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: "2.5em 0",
    background: "rgba(0, 0, 0, 0.45)",
    textAlign: "center",
    zIndex: 1000,
  };

  return (
    <div style={overlayStyle}>
      <div
        style={{
          width: 400,
          height: 250,
          background: "white",
          borderRadius: 4,
          margin: "0 auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function NmlDropArea({ clickAllowed, isUpdateAllowed, getInputProps }) {
  const clickInput = clickAllowed ? <input {...getInputProps()} /> : null;
  return (
    <div style={{ textAlign: "center", cursor: "pointer" }}>
      {clickInput}
      <div>
        <InboxOutlined style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
      </div>
      {isUpdateAllowed ? (
        <h5>Drop NML files here{clickAllowed ? " or click to select files" : null}...</h5>
      ) : (
        <h5>
          Drop NML files here to <b>create a new tracing</b>.
        </h5>
      )}
    </div>
  );
}

class NmlUploadZoneContainer extends React.PureComponent<Props, State> {
  state = {
    files: [],
    dropzoneActive: false,
    isImporting: false,
    createGroupForEachFile: true,
    createGroupForSingleFile: false,
  };

  onDragEnter = (evt: SyntheticDragEvent<>) => {
    const dt = evt.dataTransfer;
    if (!dt.types || dt.types.indexOf("Files") === -1) {
      // The dragged elements are not of type File. This happens when dragging trees or links.
      return;
    }
    this.setState({ dropzoneActive: true });
  };

  onDragLeave = () => {
    this.setState({ dropzoneActive: false });
  };

  onDrop = (files: Array<File>) => {
    this.setState({
      files,
      dropzoneActive: false,
    });

    trackAction("NML drag and drop");
    this.props.hideDropzoneModal();
  };

  renderNmlList() {
    return (
      <List
        itemLayout="horizontal"
        dataSource={this.state.files}
        renderItem={file => (
          <List.Item>
            <List.Item.Meta
              avatar={
                <Avatar size="large" icon="file" style={{ backgroundColor: "rgb(58, 144, 255)" }} />
              }
              title={
                <span style={{ wordBreak: "break-word" }}>
                  {file.name}{" "}
                  <span className="ant-list-item-meta-description">({prettyBytes(file.size)})</span>
                </span>
              }
              description={
                <span>
                  Last modified: <FormattedDate timestamp={file.lastModifiedDate} />
                </span>
              }
            />
          </List.Item>
        )}
      />
    );
  }

  importTracingFiles = async () => {
    this.setState({ isImporting: true });
    try {
      await this.props.onImport(
        this.state.files,
        this.state.files.length > 1
          ? this.state.createGroupForEachFile
          : this.state.createGroupForSingleFile,
      );
    } finally {
      this.setState({ isImporting: false, files: [] });
    }
  };

  renderDropzoneModal() {
    return (
      <Modal visible footer={null} onCancel={this.props.hideDropzoneModal}>
        {this.props.isUpdateAllowed ? (
          <Alert
            message="Did you know that you do can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
            style={{ marginBottom: 12 }}
          />
        ) : null}
        <Dropzone
          multiple
          disablePreview
          style={{
            position: "relative",
            textAlign: "center",
            border: "1px dashed #d9d9d9",
            borderRadius: 4,
            cursor: "pointer",
          }}
          onDrop={this.onDrop}
        >
          {({ getRootProps, getInputProps }) => (
            <div {...getRootProps()}>
              <NmlDropArea
                clickAllowed
                isUpdateAllowed={this.props.isUpdateAllowed}
                getInputProps={getInputProps}
              />
            </div>
          )}
        </Dropzone>
      </Modal>
    );
  }

  renderImportModal() {
    const newGroupMsg =
      this.state.files.length > 1
        ? "Create a new tree group for each file."
        : "Create a new tree group for this file.";
    const pluralS = this.state.files.length > 1 ? "s" : "";
    return (
      <Modal
        title={`Import ${this.state.files.length} Annotation${pluralS}`}
        visible={this.state.files.length > 0}
        onCancel={() => this.setState({ files: [] })}
        footer={
          <React.Fragment>
            <Checkbox
              style={{ float: "left" }}
              onChange={e =>
                this.state.files.length > 1
                  ? this.setState({ createGroupForEachFile: e.target.checked })
                  : this.setState({ createGroupForSingleFile: e.target.checked })
              }
              checked={
                this.state.files.length > 1
                  ? this.state.createGroupForEachFile
                  : this.state.createGroupForSingleFile
              }
            >
              {newGroupMsg}
            </Checkbox>
            <Button key="submit" type="primary" onClick={this.importTracingFiles}>
              {this.props.isUpdateAllowed ? "Import" : "Create New Annotation"}
            </Button>
          </React.Fragment>
        }
      >
        <Spin spinning={this.state.isImporting}>{this.renderNmlList()}</Spin>
      </Modal>
    );
  }

  render() {
    // This react component wraps its children and lays a dropzone over them.
    // That way, files can be dropped over the entire view.

    return (
      <Dropzone
        disableClick
        multiple
        disablePreview
        onDrop={this.onDrop}
        onDragEnter={this.onDragEnter}
        onDragLeave={this.onDragLeave}
        noKeyboard
      >
        {({ getRootProps, getInputProps }) => (
          <div
            {...getRootProps()}
            style={{ position: "relative", minHeight: `calc(100vh - ${navbarHeight}px)` }}
          >
            {
              // While dragging files over the view, the OverlayDropZone is rendered
              // which shows a hint to the user that he may drop files here.
            }
            {this.state.dropzoneActive && !this.props.showDropzoneModal ? (
              <OverlayDropZone>
                <NmlDropArea
                  clickAllowed={false}
                  isUpdateAllowed={this.props.isUpdateAllowed}
                  getInputProps={getInputProps}
                />
              </OverlayDropZone>
            ) : null}
            {
              // If the user explicitly selected the menu option to import NMLs,
              // we show a proper modal which renderes almost the same hint ("You may drag... or click").
            }
            {this.props.showDropzoneModal ? this.renderDropzoneModal() : null}

            {
              // Once, files were dropped, we render the import modal
            }
            {this.renderImportModal()}

            {this.props.children}
          </div>
        )}
      </Dropzone>
    );
  }
}

const mapStateToProps = (state: OxalisState): $Shape<StateProps> => ({
  showDropzoneModal: state.uiInformation.showDropzoneModal,
});

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  hideDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(false));
  },
});

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(NmlUploadZoneContainer);
