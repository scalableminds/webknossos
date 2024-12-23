import { Button, Modal, Avatar, List, Spin, Checkbox, Alert } from "antd";
import { FileOutlined, InboxOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import Dropzone, { type DropzoneInputProps } from "react-dropzone";
import * as React from "react";
import prettyBytes from "pretty-bytes";
import type { Dispatch } from "redux";
import type { OxalisState } from "oxalis/store";
import { setDropzoneModalVisibilityAction } from "oxalis/model/actions/ui_actions";
import FormattedDate from "components/formatted_date";

type State = {
  files: Array<File>;
  dropzoneActive: boolean;
  isImporting: boolean;
  createGroupForEachFile: boolean;
  createGroupForSingleFile: boolean;
};
type OwnProps = {
  children: React.ReactNode;
  isUpdateAllowed: boolean;
  onImport: (files: Array<File>, createGroupForEachFile: boolean) => Promise<void>;
};
type StateProps = {
  showDropzoneModal: boolean;
  hideDropzoneModal: () => void;
  navbarHeight: number;
};
type Props = StateProps & OwnProps;

function OverlayDropZone({ children }: { children: React.ReactNode }) {
  return (
    <div className="nml-upload-zone-overlay">
      <div className="nml-upload-zone-modal">{children}</div>
    </div>
  );
}

function NmlDropArea({
  isClickAllowed,
  isUpdateAllowed,
  getInputProps,
}: {
  isClickAllowed: boolean;
  isUpdateAllowed: boolean;
  getInputProps: (props?: DropzoneInputProps) => DropzoneInputProps;
}) {
  const clickInput = isClickAllowed ? <input {...getInputProps()} /> : null;
  return (
    <div
      style={{
        textAlign: "center",
        cursor: "pointer",
      }}
    >
      {clickInput}
      <div>
        <InboxOutlined
          style={{
            fontSize: 180,
            color: "var(--ant-color-primary)",
          }}
        />
      </div>
      {isUpdateAllowed ? (
        <h5>Drop NML or zip files here{isClickAllowed ? " or click to select files" : null}...</h5>
      ) : (
        <h5>
          Drop NML or zip files here to <b>create a new annotation</b>.
        </h5>
      )}
    </div>
  );
}

class NmlUploadZoneContainer extends React.PureComponent<Props, State> {
  _isMounted: boolean = false;

  state: State = {
    files: [],
    dropzoneActive: false,
    isImporting: false,
    createGroupForEachFile: true,
    createGroupForSingleFile: false,
  };

  componentDidMount() {
    this._isMounted = true;
  }

  componentWillUnmount() {
    this._isMounted = false;
  }

  onDragEnter = (evt: React.DragEvent) => {
    const dt = evt.dataTransfer;

    if (!dt.types || dt.types.indexOf("Files") === -1) {
      // The dragged elements are not of type File. This happens when dragging trees or links.
      return;
    }

    this.setState({
      dropzoneActive: true,
    });
  };
  onDragLeave = () => {
    this.setState({
      dropzoneActive: false,
    });
  };
  onDrop = (files: Array<File>) => {
    this.setState({
      files,
      dropzoneActive: false,
    });
    this.props.hideDropzoneModal();
  };

  renderNmlList() {
    return (
      <List
        itemLayout="horizontal"
        dataSource={this.state.files}
        renderItem={(file: File) => (
          <List.Item>
            <List.Item.Meta
              avatar={
                <Avatar
                  size="large"
                  icon={<FileOutlined />}
                  style={{
                    backgroundColor: "var(--ant-color-primary)",
                  }}
                />
              }
              title={
                <span
                  style={{
                    wordBreak: "break-word",
                  }}
                >
                  {file.name}{" "}
                  <span className="ant-list-item-meta-description">({prettyBytes(file.size)})</span>
                </span>
              }
              description={
                <span>
                  Last modified: <FormattedDate timestamp={file.lastModified} />
                </span>
              }
            />
          </List.Item>
        )}
      />
    );
  }

  importTracingFiles = async () => {
    this.setState({
      isImporting: true,
    });

    try {
      await this.props.onImport(
        this.state.files,
        this.state.files.length > 1
          ? this.state.createGroupForEachFile
          : this.state.createGroupForSingleFile,
      );
    } finally {
      if (this._isMounted) {
        this.setState({
          isImporting: false,
          files: [],
        });
      }
    }
  };

  renderDropzoneModal() {
    return (
      <Modal open footer={null} onCancel={this.props.hideDropzoneModal}>
        {this.props.isUpdateAllowed ? (
          <Alert
            message="Did you know that you do can just drag-and-drop NML files directly into this view? You don't have to explicitly open this dialog first."
            style={{
              marginBottom: 12,
            }}
          />
        ) : null}
        <Dropzone multiple onDrop={this.onDrop}>
          {({ getRootProps, getInputProps }) => (
            <div {...getRootProps()}>
              <NmlDropArea
                isClickAllowed
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
        open={this.state.files.length > 0}
        onCancel={() =>
          this.setState({
            files: [],
          })
        }
        footer={
          <React.Fragment>
            <Checkbox
              style={{
                float: "left",
              }}
              onChange={(e) =>
                this.state.files.length > 1
                  ? this.setState({
                      createGroupForEachFile: e.target.checked,
                    })
                  : this.setState({
                      createGroupForSingleFile: e.target.checked,
                    })
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
        noClick
        multiple
        onDrop={this.onDrop}
        onDragEnter={this.onDragEnter}
        onDragLeave={this.onDragLeave}
        noKeyboard
      >
        {({ getRootProps, getInputProps }) => (
          <div
            {...getRootProps()}
            style={{
              position: "relative",
              height: `calc(100vh - ${this.props.navbarHeight}px)`,
            }}
            className="flex-column"
          >
            {
              // While dragging files over the view, the OverlayDropZone is rendered
              // which shows a hint to the user that he may drop files here.
            }
            {this.state.dropzoneActive && !this.props.showDropzoneModal ? (
              <OverlayDropZone>
                <NmlDropArea
                  isClickAllowed={false}
                  isUpdateAllowed={this.props.isUpdateAllowed}
                  getInputProps={getInputProps}
                />
              </OverlayDropZone>
            ) : null}
            {
              // If the user explicitly selected the menu option to import NMLs,
              // we show a proper modal which renders almost the same hint ("You may drag... or click").
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

const mapStateToProps = (state: OxalisState) => ({
  showDropzoneModal: state.uiInformation.showDropzoneModal,
  navbarHeight: state.uiInformation.navbarHeight,
});

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  hideDropzoneModal() {
    dispatch(setDropzoneModalVisibilityAction(false));
  },
});

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(NmlUploadZoneContainer);
