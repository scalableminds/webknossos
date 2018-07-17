// @flow
import * as React from "react";
import Dropzone from "react-dropzone";
import moment from "moment";
import prettyBytes from "pretty-bytes";
import { Icon, Modal, Avatar, List, Spin } from "antd";
import { readFileAsText } from "components/file_upload";
import { parseNml } from "oxalis/model/helpers/nml_helpers";
import { addTreesAndGroupsAction } from "oxalis/model/actions/skeletontracing_actions";
import Toast from "libs/toast";
import Store from "oxalis/store";

type State = {
  files: Array<*>,
  dropzoneActive: boolean,
  isImporting: boolean,
};

type Props = {
  children: React.Node,
};

function OverlayDropZone({ showDropZone }) {
  if (!showDropZone) {
    return null;
  }
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
        <div>
          <Icon type="inbox" style={{ fontSize: 180, color: "rgb(58, 144, 255)" }} />
        </div>
        <h4>Drop NML files here...</h4>
      </div>
    </div>
  );
}

export default class NmlUploadZone extends React.PureComponent<Props, State> {
  state = {
    files: [],
    dropzoneActive: false,
    isImporting: false,
  };

  onDragEnter(evt: SyntheticDragEvent<>) {
    const dt = evt.dataTransfer;
    if (!dt.types || dt.types.indexOf("Files") === -1) {
      // The dragged elements are not of type File. This happens when dragging trees or links.
      return;
    }
    this.setState({ dropzoneActive: true });
  }

  onDragLeave() {
    this.setState({ dropzoneActive: false });
  }

  onDrop(files: Array<*>) {
    this.setState({
      files,
      dropzoneActive: false,
    });
  }

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
      for (const file of this.state.files) {
        const nmlString = await readFileAsText(file);
        const { trees, treeGroups } = await parseNml(nmlString);
        Store.dispatch(addTreesAndGroupsAction(trees, treeGroups));
      }
    } catch (e) {
      Toast.error(e.message);
    } finally {
      this.setState({ isImporting: false, files: [] });
    }
  };

  render() {
    const { files, dropzoneActive } = this.state;

    return (
      <Dropzone
        disableClick
        style={{ position: "relative" }}
        multiple
        disablePreview
        onDrop={this.onDrop.bind(this)}
        onDragEnter={this.onDragEnter.bind(this)}
        onDragLeave={this.onDragLeave.bind(this)}
      >
        <OverlayDropZone showDropZone={this.state.dropzoneActive} />
        <Modal
          title={`Import ${this.state.files.length} NML files`}
          visible={this.state.files.length > 0}
          onOk={this.importNmls}
          onCancel={() => this.setState({ files: [] })}
        >
          <Spin spinning={this.state.isImporting}>{this.renderModalContent()}</Spin>
        </Modal>
        {this.props.children}
      </Dropzone>
    );
  }
}
