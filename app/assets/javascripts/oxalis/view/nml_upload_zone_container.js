// @flow
import { Button, Icon, Modal, Avatar, List, Spin, Checkbox, Alert } from "antd";
import { connect } from "react-redux";
import Dropzone from "react-dropzone";
import * as React from "react";
import prettyBytes from "pretty-bytes";
import type { Dispatch } from "redux";

import type { OxalisState } from "oxalis/store";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import FormattedDate from "components/formatted_date";
import { trackAction } from "oxalis/model/helpers/analytics";

type State = {
  files: Array<File>,
  dropzoneActive: boolean,
  isImporting: boolean,
  createGroupForEachFile: boolean,
};

type OwnProps = {|
  children: React.Node,
  isAllowed: boolean,
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
    background: "rgba(0, 0, 0, 0.65)",
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

function NmlDropArea({ showClickHint, isAllowed }) {
  return (
    <React.Fragment>
      <div>
        <Icon type="inbox" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
      </div>
      {isAllowed ? (
        <h5>Drop NML files here{showClickHint ? " or click to select files" : null}...</h5>
      ) : (
        <h5 style={{ color: "rgb(247,80,61)" }}>
          You cannot upload NML files into a read-only tracing.
        </h5>
      )}
    </React.Fragment>
  );
}

class NmlUploadZoneContainer extends React.PureComponent<Props, State> {
  state = {
    files: [],
    dropzoneActive: false,
    isImporting: false,
    createGroupForEachFile: true,
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
    if (this.props.isAllowed) {
      this.setState({
        files,
        dropzoneActive: false,
      });
    } else {
      this.setState({ dropzoneActive: false });
    }
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
                <span>
                  {file.name}{" "}
                  <span className="ant-list-item-meta-description">({prettyBytes(file.size)})</span>
                </span>
              }
              description={
                <span>
                  Last modification date: <FormattedDate timestamp={file.lastModifiedDate} />
                </span>
              }
            />
          </List.Item>
        )}
      />
    );
  }

  importNmls = async () => {
    this.setState({ isImporting: true });
    try {
      await this.props.onImport(
        this.state.files,
        this.state.files.length > 1 ? this.state.createGroupForEachFile : false,
      );
    } finally {
      this.setState({ isImporting: false, files: [] });
    }
  };

  renderDropzoneModal() {
    return (
      <Modal visible footer={null} onCancel={this.props.hideDropzoneModal}>
        {this.props.isAllowed ? (
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
          <NmlDropArea showClickHint isAllowed={this.props.isAllowed} />
        </Dropzone>
      </Modal>
    );
  }

  renderImportModal() {
    const createGroupsCheckbox = (
      <Checkbox
        style={{ float: "left" }}
        onChange={e => this.setState({ createGroupForEachFile: e.target.checked })}
        checked={this.state.createGroupForEachFile}
      >
        Create a new tree group for each file.
      </Checkbox>
    );
    return (
      <Modal
        title={`Import ${this.state.files.length} NML file(s)`}
        visible={this.state.files.length > 0}
        onCancel={() => this.setState({ files: [] })}
        footer={
          <React.Fragment>
            {this.state.files.length > 1 ? createGroupsCheckbox : null}
            <Button key="submit" type="primary" onClick={this.importNmls}>
              Import
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
        style={{ position: "relative" }}
        multiple
        disablePreview
        onDrop={this.onDrop}
        onDragEnter={this.onDragEnter}
        onDragLeave={this.onDragLeave}
      >
        {
          // While dragging files over the view, the OverlayDropZone is rendered
          // which shows a hint to the user that he may drop files here.
        }
        {this.state.dropzoneActive && !this.props.showDropzoneModal ? (
          <OverlayDropZone>
            <NmlDropArea showClickHint={false} isAllowed={this.props.isAllowed} />
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
