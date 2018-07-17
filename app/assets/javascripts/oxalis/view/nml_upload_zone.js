// @flow
import * as React from "react";
import Dropzone from "react-dropzone";
import moment from "moment";
import prettyBytes from "pretty-bytes";
import { Button, Icon, Modal, Avatar, List, Spin, Checkbox, Alert } from "antd";
import { readFileAsText } from "components/file_upload";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import Toast from "libs/toast";
import Store from "oxalis/store";
import type { OxalisState } from "oxalis/store";
import { connect } from "react-redux";

type State = {
  files: Array<*>,
  dropzoneActive: boolean,
  isImporting: boolean,
  createGroupForEachFile: boolean,
};

type StateProps = {
  showDropzoneModal: boolean,
  hideDropzoneModal: () => void,
};

type Props = StateProps & {
  children: React.Node,
};

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

function NmlDropArea({ showClickHint }) {
  return (
    <React.Fragment>
      <div>
        <Icon type="inbox" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
      </div>
      <h5>Drop NML files here{showClickHint ? " or click to select files" : null}...</h5>
    </React.Fragment>
  );
}

class NmlUploadZone extends React.PureComponent<Props, State> {
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

  onDrop = (files: Array<*>) => {
    this.setState({
      files,
      dropzoneActive: false,
    });

    this.props.hideDropzoneModal();
  };

  renderModalContent() {
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
              description={`Last modification date: ${moment(file.lastModifiedDate).format(
                "YYYY-MM-DD HH:mm",
              )}`}
            />
          </List.Item>
        )}
      />
    );
  }

  importNmls = async () => {
    this.setState({
      isImporting: true,
    });
    try {
      const importActions = await Promise.all(
        this.state.files.map(async file => {
          const nmlString = await readFileAsText(file);
          const { trees, treeGroups } = await parseNml(
            nmlString,
            this.state.createGroupForEachFile ? file.name : null,
          );

          return addTreesAndGroupsAction(trees, treeGroups);
        }),
      );

      // Dispatch the actual actions as the very last step, so that
      // not a single store mutation happens if something above throws
      // an error
      importActions.forEach(action => Store.dispatch(action));
    } catch (e) {
      Toast.error(e.message);
    } finally {
      this.setState({ isImporting: false, files: [] });
    }
  };

  render() {
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
        {this.state.dropzoneActive && !this.props.showDropzoneModal ? (
          <OverlayDropZone>
            <NmlDropArea showClickHint={false} />
          </OverlayDropZone>
        ) : null}
        {this.props.showDropzoneModal ? (
          <Modal visible footer={null} onCancel={this.props.hideDropzoneModal}>
            <Alert
              message="Did you know that you do can just drop NML files directly into the tracing view? You don't have to explicitly open this dialog first."
              style={{ marginBottom: 12 }}
            />
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
              <NmlDropArea showClickHint />
            </Dropzone>
          </Modal>
        ) : null}

        <Modal
          title={`Import ${this.state.files.length} NML file(s)`}
          visible={this.state.files.length > 0}
          onOk={this.importNmls}
          onCancel={() => this.setState({ files: [] })}
          footer={
            <React.Fragment>
              <Checkbox
                style={{ float: "left" }}
                onChange={e => this.setState({ createGroupForEachFile: e.target.checked })}
                checked={this.state.createGroupForEachFile}
              >
                Create a new tree group for each file.
              </Checkbox>
              <Button key="submit" type="primary" onClick={this.importNmls}>
                Import
              </Button>
            </React.Fragment>
          }
        >
          <Spin spinning={this.state.isImporting}>{this.renderModalContent()}</Spin>
        </Modal>
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

export default connect(
  mapStateToProps,
  mapDispatchToProps,
)(NmlUploadZone);
