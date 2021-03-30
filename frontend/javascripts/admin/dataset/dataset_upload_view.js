// @flow
import { Avatar, Form, Button, Icon, Col, Row, Tooltip, Modal, Progress, Alert, List } from "antd";
import { connect } from "react-redux";
import React, { useMemo } from "react";
import moment from "moment";
import _ from "lodash";
import { useDropzone } from "react-dropzone";

import { type RouterHistory, withRouter } from "react-router-dom";
import type { APITeam, APIDataStore, APIUser, APIDatasetId } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import {
  finishDatasetUpload,
  createResumableUpload,
  startConvertToWkwJob,
  sendFailedRequestAnalyticsEvent,
} from "admin/admin_rest_api";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";
import { trackAction } from "oxalis/model/helpers/analytics";
import { createReader, BlobReader } from "zip-js-webpack";
import {
  CardContainer,
  DatasetNameFormItem,
  DatastoreFormItem,
} from "admin/dataset/dataset_components";
import { Vector3Input } from "libs/vector_input";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import features from "features";
import { syncValidator } from "types/validation";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  withoutCard?: boolean,
  onUploaded: (string, string, boolean) => Promise<void> | void,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithFormAndRouter = {|
  ...Props,
  history: RouterHistory,
  form: Object,
|};

type State = {
  isUploading: boolean,
  needsConversion: boolean,
  isRetrying: boolean,
  uploadProgress: number,
  selectedTeams: APITeam | Array<APITeam>,
};

class DatasetUploadView extends React.PureComponent<PropsWithFormAndRouter, State> {
  state = {
    isUploading: false,
    needsConversion: false,
    isRetrying: false,
    uploadProgress: 0,
    selectedTeams: [],
  };

  formRef = React.createRef<FormInstance>();

  static getDerivedStateFromProps(props) {
    if (
      props.datastores.length === 1 &&
      props.form.getFieldValue("datastore") !== props.datastores[0].url
    ) {
      props.form.setFieldsValue({ datastore: props.datastores[0].url });
    }
    return null;
  }

  isDatasetManagerOrAdmin = () =>
    this.props.activeUser &&
    (this.props.activeUser.isAdmin || this.props.activeUser.isDatasetManager);

  handleSubmit = evt => {
    evt.preventDefault();
    const form = this.formRef.current;
    if (!form) {
      return;
    }
    form.validateFields(async (err, formValues) => {
      const { activeUser } = this.props;

      if (!err && activeUser != null) {
        Toast.info("Uploading dataset");
        this.setState({
          isUploading: true,
        });

        const beforeUnload = action => {
          // Only show the prompt if this is a proper beforeUnload event from the browser
          // or the pathname changed
          // This check has to be done because history.block triggers this function even if only the url hash changed
          if (action === undefined || evt.pathname !== window.location.pathname) {
            const { isUploading } = this.state;
            if (isUploading) {
              window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event
              window.setTimeout(() => {
                // restore the event handler in case a user chose to stay on the page
                window.onbeforeunload = beforeUnload;
              }, 500);
              return messages["dataset.leave_during_upload"];
            }
          }
          return null;
        };

        this.props.history.block(beforeUnload);
        window.onbeforeunload = beforeUnload;

        const datasetId: APIDatasetId = {
          name: formValues.name,
          owningOrganization: activeUser.organization,
        };
        const getRandomString = () => {
          const randomBytes = window.crypto.getRandomValues(new Uint8Array(6));
          return Array.from(randomBytes, byte => `0${byte.toString(16)}`.slice(-2)).join("");
        };

        const uploadId = `${moment(Date.now()).format("YYYY-MM-DD_HH-mm")}__${
          datasetId.name
        }__${getRandomString()}`;

        const resumableUpload = await createResumableUpload(
          datasetId,
          formValues.datastore,
          formValues.zipFile.length,
          uploadId,
        );

        resumableUpload.on("complete", () => {
          const newestForm = this.formRef.current;
          if (!newestForm) {
            return;
          }

          const uploadInfo = {
            uploadId,
            organization: datasetId.owningOrganization,
            name: datasetId.name,
            initialTeams: formValues.initialTeams.map(team => team.id),
            needsConversion: this.state.needsConversion,
          };

          finishDatasetUpload(formValues.datastore, uploadInfo).then(
            async () => {
              Toast.success(messages["dataset.upload_success"]);
              trackAction("Upload dataset");
              await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
              let maybeError;
              if (this.state.needsConversion) {
                try {
                  await startConvertToWkwJob(
                    formValues.name,
                    activeUser.organization,
                    formValues.scale,
                  );
                } catch (error) {
                  maybeError = error;
                }
                if (maybeError == null) {
                  Toast.info(
                    <React.Fragment>
                      The conversion for the uploaded dataset was started.
                      <br />
                      Click{" "}
                      <a
                        target="_blank"
                        href="https://github.com/scalableminds/webknossos-cuber/"
                        rel="noopener noreferrer"
                      >
                        here
                      </a>{" "}
                      to see all running jobs.
                    </React.Fragment>,
                  );
                } else {
                  Toast.error(
                    "The conversion for the uploaded dataset could not be started. Please try again or contact us if this issue occurs again.",
                  );
                }
              }
              this.setState({ isUploading: false });
              if (maybeError == null) {
                newestForm.setFieldsValue({ name: null, zipFile: [] });
                this.props.onUploaded(
                  activeUser.organization,
                  formValues.name,
                  this.state.needsConversion,
                );
              }
            },
            error => {
              sendFailedRequestAnalyticsEvent("finish_dataset_upload", error, {
                dataset_name: datasetId.name,
              });
              Toast.error(messages["dataset.upload_failed"]);
              this.setState({
                isUploading: false,
                isRetrying: false,
                uploadProgress: 0,
              });
            },
          );
        });

        resumableUpload.on("filesAdded", () => {
          resumableUpload.upload();
        });

        resumableUpload.on("fileError", (file, message) => {
          Toast.error(message);
          this.setState({ isUploading: false });
        });

        resumableUpload.on("progress", () => {
          this.setState({ isRetrying: false, uploadProgress: resumableUpload.progress() });
        });

        resumableUpload.on("fileRetry", () => {
          this.setState({ isRetrying: true });
        });

        resumableUpload.addFiles(formValues.zipFile);
      }
    });
  };

  getUploadModal = () => {
    const form = this.formRef.current;
    if (!form) {
      return null;
    }
    const { isRetrying, uploadProgress, isUploading } = this.state;
    return (
      <Modal
        visible={isUploading}
        closable={false}
        keyboard={false}
        maskClosable={false}
        className="no-footer-modal"
        cancelButtonProps={{ style: { display: "none" } }}
        okButtonProps={{ style: { display: "none" } }}
      >
        <div style={{ display: "flex", alignItems: "center", flexDirection: "column" }}>
          <Icon type="folder" style={{ fontSize: 50 }} />
          <br />
          {isRetrying
            ? `Upload of dataset ${form.getFieldValue("name")} froze.`
            : `Uploading Dataset ${form.getFieldValue("name")}.`}
          <br />
          {isRetrying ? "Retrying to continue the upload..." : null}
          <br />
          <Progress
            // Round to 1 digit after the comma. Don't show 100%, since there is
            // some additional delay until the UI shows the next screen.
            // Otherwise, the user might think that nothing will happen after 100%
            // was reached.
            percent={Math.min(99.9, Math.round(uploadProgress * 1000) / 10)}
            status="active"
          />
        </div>
      </Modal>
    );
  };

  onFilesChange = files => {
    this.maybeSetUploadName(files);
    this.validateFiles(files);
  };

  validateFiles = files => {
    const form = this.formRef.current;
    if (!form) {
      return;
    }
    if (files.length === 0) {
      return;
    }

    let needsConversion = true;
    for (const file of files) {
      const filenameParts = file.name.split(".");
      const fileExtension = filenameParts[filenameParts.length - 1].toLowerCase();
      if (fileExtension === "zip") {
        createReader(
          new BlobReader(file),
          reader => {
            reader.getEntries(entries => {
              const wkwFile = entries.find(entry =>
                Utils.isFileExtensionEqualTo(entry.filename, "wkw"),
              );
              const hasArchiveWkwFile = wkwFile != null;
              this.handleNeedsConversionInfo(!hasArchiveWkwFile);
            });
          },
          () => {
            Modal.error({
              content: messages["dataset.upload_invalid_zip"],
            });
            form.setFieldsValue({ zipFile: [] });
          },
        );
        // We return here since not more than 1 zip archive is supported anyway.
        return;
      } else if (fileExtension === "wkw") {
        needsConversion = false;
      }
    }

    this.handleNeedsConversionInfo(needsConversion);
  };

  handleNeedsConversionInfo = needsConversion => {
    const form = this.formRef.current;
    if (!form) {
      return;
    }
    this.setState({ needsConversion });
    if (needsConversion && !features().jobsEnabled) {
      form.setFieldsValue({ zipFile: [] });
      Modal.info({
        content: (
          <div>
            The selected dataset does not seem to be in the WKW format. Please convert the dataset
            using{" "}
            <a
              target="_blank"
              href="https://github.com/scalableminds/webknossos-cuber/"
              rel="noopener noreferrer"
            >
              webknossos-cuber
            </a>{" "}
            or use a webKnossos instance which integrates a conversion service, such as{" "}
            <a target="_blank" href="http://webknossos.org/" rel="noopener noreferrer">
              webknossos.org
            </a>
            .
          </div>
        ),
      });
    }
  };

  maybeSetUploadName = files => {
    const form = this.formRef.current;
    if (!form) {
      return;
    }
    if (!form.getFieldValue("name") && files.length > 0) {
      const filenameParts = files[0].name.split(".");
      const filename = filenameParts.slice(0, -1).join(".");
      form.setFieldsValue({ name: filename });
      form.validateFields(["name"]);
    }
  };

  render() {
    const form = this.formRef.current;
    if (!form) {
      return null;
    }
    const { activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;
    const isDatasetManagerOrAdmin = this.isDatasetManagerOrAdmin();
    const { needsConversion } = this.state;
    const uploadableDatastores = datastores.filter(datastore => datastore.allowsUpload);
    const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <CardContainer withoutCard={withoutCard} title="Upload Dataset">
          <Form onSubmit={this.handleSubmit} layout="vertical" ref={this.formRef}>
            {features().isDemoInstance && (
              <Alert
                message={
                  <>
                    We are happy to help!
                    <br />
                    Please <a href="mailto:hello@webknossos.org">contact us</a> if you have any
                    trouble uploading your data or the uploader doesn&apos;t support your format
                    yet.
                  </>
                }
                type="info"
                style={{ marginBottom: 50 }}
              />
            )}
            <Row gutter={8}>
              <Col span={12}>
                <DatasetNameFormItem form={form} activeUser={activeUser} />
              </Col>
              <Col span={12}>
                <FormItem label="Teams allowed to access this dataset" hasFeedback>
                  {getFieldDecorator("initialTeams", {
                    rules: [
                      {
                        required: !isDatasetManagerOrAdmin,
                        message: !isDatasetManagerOrAdmin
                          ? messages["dataset.import.required.initialTeam"]
                          : null,
                      },
                    ],
                    initialValue: [],
                  })(
                    <Tooltip title="Except for administrators and dataset managers, only members of the teams defined here will be able to view this dataset.">
                      <TeamSelectionComponent
                        mode="multiple"
                        value={this.state.selectedTeams}
                        onChange={selectedTeams => {
                          if (!Array.isArray(selectedTeams)) {
                            // Making sure that we always have an array even when only one team is selected.
                            selectedTeams = [selectedTeams];
                          }
                          form.setFieldsValue({ initialTeams: selectedTeams });
                          this.setState({ selectedTeams });
                        }}
                        afterFetchedTeams={fetchedTeams => {
                          if (!features().isDemoInstance) {
                            return;
                          }
                          const teamOfOrganisation = fetchedTeams.find(
                            team => team.name === team.organization,
                          );
                          if (teamOfOrganisation == null) {
                            return;
                          }
                          this.setState({ selectedTeams: [teamOfOrganisation] });
                          form.setFieldsValue({
                            initialTeams: [teamOfOrganisation],
                          });
                        }}
                      />
                    </Tooltip>,
                  )}
                </FormItem>
              </Col>
            </Row>
            <DatastoreFormItem
              form={form}
              datastores={uploadableDatastores}
              hidden={hasOnlyOneDatastoreOrNone}
            />
            {features().jobsEnabled && needsConversion ? (
              <React.Fragment>
                <FormItemWithInfo
                  label="Voxel Size"
                  info="The voxel size defines the extent (for x, y, z) of one voxel in nanometer."
                  disabled={this.state.needsConversion}
                  help="Your dataset is not yet in WKW Format. Therefore you need to define the voxel size."
                >
                  {getFieldDecorator("scale", {
                    initialValue: [0, 0, 0],
                    rules: [
                      {
                        required: this.state.needsConversion,
                        message: "Please provide a scale for the dataset.",
                      },
                      {
                        validator: syncValidator(
                          value => value && value.every(el => el > 0),
                          "Each component of the scale must be larger than 0.",
                        ),
                      },
                    ],
                  })(
                    <Vector3Input
                      style={{ width: 400 }}
                      allowDecimals
                      onChange={scale => form.setFieldsValue({ scale })}
                    />,
                  )}
                </FormItemWithInfo>
              </React.Fragment>
            ) : null}

            <FormItem label="Dataset" hasFeedback>
              {getFieldDecorator("zipFile", {
                rules: [
                  { required: true, message: messages["dataset.import.required.zipFile"] },
                  {
                    validator: syncValidator(
                      files =>
                        files.filter(file => Utils.isFileExtensionEqualTo(file.path, "zip"))
                          .length <= 1,
                      "You cannot upload more than one archive.",
                    ),
                  },
                  {
                    validator: syncValidator(
                      files =>
                        files.filter(file =>
                          Utils.isFileExtensionEqualTo(file.path, ["tar", "rar"]),
                        ).length === 0,
                      "Tar and rar archives are not supported currently. Please use zip archives.",
                    ),
                  },
                  {
                    validator: syncValidator(files => {
                      const archives = files.filter(file =>
                        Utils.isFileExtensionEqualTo(file.path, "zip"),
                      );
                      // Either there are no archives, or all files are archives
                      return archives.length === 0 || archives.length === files.length;
                    }, "Archives cannot be mixed with other files."),
                  },
                  {
                    validator: syncValidator(files => {
                      const wkwFiles = files.filter(file =>
                        Utils.isFileExtensionEqualTo(file.path, "wkw"),
                      );
                      const imageFiles = files.filter(file =>
                        Utils.isFileExtensionEqualTo(file.path, [
                          "tif",
                          "tiff",
                          "jpg",
                          "jpeg",
                          "png",
                        ]),
                      );
                      return wkwFiles.length === 0 || imageFiles.length === 0;
                    }, "WKW files should not be mixed with image files."),
                  },
                ],
                valuePropName: "fileList",
                initialValue: [],
                onChange: this.onFilesChange,
              })(
                // Provide null values to satisfy flow (overwritten by getFieldDecorator)
                <FileUploadArea onChange={_files => {}} fileList={[]} />,
              )}
            </FormItem>
            <FormItem style={{ marginBottom: 0 }}>
              <Button size="large" type="primary" htmlType="submit" style={{ width: "100%" }}>
                Upload
              </Button>
            </FormItem>
          </Form>
        </CardContainer>
        {this.getUploadModal()}
      </div>
    );
  }
}

const baseStyle: Object = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "20px",
  borderWidth: 2,
  borderRadius: 2,
  borderColor: "#eeeeee",
  borderStyle: "dashed",
  backgroundColor: "#fafafa",
  color: "rgba(0, 0, 0, 0.85)",
  fontSize: 16,
  outline: "none",
  transition: "border .24s ease-in-out",
  cursor: "pointer",
};

const activeStyle: Object = {
  borderColor: "#2196f3",
};

const acceptStyle: Object = {
  borderColor: "#00e676",
};

const rejectStyle: Object = {
  borderColor: "#ff1744",
};

function FileUploadArea({ fileList, onChange }) {
  const onDropAccepted = acceptedFiles => {
    // file.path should be set by react-dropzone (which uses file-selector::toFileWithPath).
    onChange(_.uniqBy(fileList.concat(acceptedFiles), file => file.path));
  };
  const removeFile = file => {
    onChange(_.without(fileList, file));
  };
  const { getRootProps, getInputProps, isDragActive, isDragAccept, isDragReject } = useDropzone({
    onDropAccepted,
  });
  const acceptedFiles = fileList;

  const style: Object = useMemo(
    () => ({
      ...baseStyle,
      ...(isDragActive ? activeStyle : {}),
      ...(isDragAccept ? acceptStyle : {}),
      ...(isDragReject ? rejectStyle : {}),
    }),
    [isDragActive, isDragReject, isDragAccept],
  );

  const files = acceptedFiles.map(file => <li key={file.path}>{file.path}</li>);

  const showSmallFileList = files.length > 10;
  const list = (
    <List
      itemLayout="horizontal"
      dataSource={acceptedFiles}
      size={showSmallFileList ? "small" : "default"}
      renderItem={item => (
        <List.Item
          actions={[
            <a key="list-loadmore-edit" onClick={() => removeFile(item)}>
              remove
            </a>,
          ]}
        >
          <List.Item.Meta
            avatar={
              !showSmallFileList && (
                <Avatar>
                  <Icon type="file" />
                </Avatar>
              )
            }
            title={
              <span>
                {showSmallFileList && <Icon type="file" />}{" "}
                <span style={{ color: "darkgrey" }}>{`${item.path
                  .split("/")
                  .slice(0, -1)
                  .join("/")}/`}</span>
                {item.name}
              </span>
            }
          />
        </List.Item>
      )}
    />
  );

  return (
    <div>
      <div {...getRootProps({ style })}>
        <input {...getInputProps()} />
        <Icon type="inbox" style={{ fontSize: 48, color: "#41a9ff" }} />
        <p style={{ maxWidth: 800, textAlign: "center", marginTop: 8 }}>
          Drag your file(s) to this area to upload them. Either add individual image files, a zip
          archive or a folder. Alternatively, click to select your files via a file picker.{" "}
          {features().jobsEnabled
            ? "Your data is automatically converted to WKW after upload if necessary."
            : null}
        </p>
      </div>

      {files.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <h5>Files</h5>
          <div style={{ maxHeight: 600, overflowY: "auto" }}>{list}</div>
        </div>
      ) : null}
    </div>
  );
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(DatasetUploadView));
