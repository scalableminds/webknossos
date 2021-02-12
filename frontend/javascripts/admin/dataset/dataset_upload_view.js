// @flow
import { Form, Button, Upload, Icon, Col, Row, Tooltip, Modal, Progress } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import { type RouterHistory, withRouter } from "react-router-dom";
import type { APITeam, APIDataStore, APIUser, APIDatasetId } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { finishDatasetUpload, createResumableUpload, startJob } from "admin/admin_rest_api";
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

  normFile = e => {
    // Ensure that only one dataset can be uploaded simultaneously
    if (Array.isArray(e)) {
      return e.slice(-1);
    }
    return e && e.fileList.slice(-1);
  };

  handleSubmit = evt => {
    evt.preventDefault();

    this.props.form.validateFields(async (err, formValues) => {
      const { activeUser } = this.props;

      // Workaround: Antd replaces file objects in the formValues with a wrapper file
      // The original file object is contained in the originFileObj property
      // This is most likely not intentional and may change in a future Antd version
      formValues.zipFile = formValues.zipFile.map(wrapperFile => wrapperFile.originFileObj);

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

        const resumableUpload = await createResumableUpload(datasetId, formValues.datastore);

        resumableUpload.on("fileSuccess", file => {
          const { form } = this.props;
          const uploadInfo = {
            uploadId: file.uniqueIdentifier,
            organization: datasetId.owningOrganization,
            name: datasetId.name,
            initialTeams: formValues.initialTeams.map(team => team.id),
            needsConversion: formValues.needsConversion,
          };

          finishDatasetUpload(formValues.datastore, uploadInfo).then(
            async () => {
              Toast.success(messages["dataset.upload_success"]);
              trackAction("Upload dataset");
              await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
              if (this.state.needsConversion) {
                await startJob(formValues.name, activeUser.organization, formValues.scale);
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
              }
              form.setFieldsValue({ name: null, zipFile: null });
              this.setState({ isUploading: false });
              this.props.onUploaded(
                activeUser.organization,
                formValues.name,
                this.state.needsConversion,
              );
            },
            () => {
              Toast.error(messages["dataset.upload_failed"]);
              this.setState({
                isUploading: false,
                isRetrying: false,
                uploadProgress: 0,
              });
            },
          );
        });

        resumableUpload.on("fileAdded", () => {
          resumableUpload.upload();
        });

        resumableUpload.on("fileError", (file, message) => {
          Toast.error(message);
          this.setState({ isUploading: false });
        });

        resumableUpload.on("fileProgress", file => {
          this.setState({ isRetrying: false, uploadProgress: file.progress(false) });
        });

        resumableUpload.on("fileRetry", () => {
          this.setState({ isRetrying: true });
        });

        resumableUpload.addFiles(formValues.zipFile);
      }
    });
  };

  getUploadModal = () => {
    const { form } = this.props;
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
            // Round to 1 digit after the comma.
            percent={Math.round(uploadProgress * 1000) / 10}
            status="active"
          />
        </div>
      </Modal>
    );
  };

  handleFileDrop = file => {
    const { form } = this.props;
    const filenameParts = file.name.split(".");
    if (filenameParts[filenameParts.length - 1] !== "zip") {
      Modal.error({
        content: messages["dataset.upload_none_zip_error"],
      });
      // Directly setting the zip file to null does not work.
      setTimeout(() => form.setFieldsValue({ zipFile: null }), 500);
      return false;
    }
    if (!form.getFieldValue("name")) {
      const filename = filenameParts.slice(0, -1).join(".");
      form.setFieldsValue({ name: filename });
      form.validateFields(["name"]);
    }
    file.thumbUrl = "/assets/images/folder.svg";
    // Set the file here, as setting it after checking for the wkw format
    // results in an error: When trying to upload the file it is somehow undefined.
    form.setFieldsValue({ zipFile: [file] });
    const blobReader = new BlobReader(file);
    createReader(
      blobReader,
      reader => {
        reader.getEntries(entries => {
          const wkwFile = entries.find(entry =>
            Utils.isFileExtensionEqualTo(entry.filename, "wkw"),
          );
          const isNotWkwFormat = wkwFile == null;
          this.setState({
            needsConversion: isNotWkwFormat,
          });
          if (isNotWkwFormat && !features().jobsEnabled) {
            form.setFieldsValue({ zipFile: null });
            Modal.info({
              content: (
                <div>
                  The selected dataset does not seem to be in the WKW format. Please convert the
                  dataset using{" "}
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
        });
      },
      () => {
        Modal.error({
          content: messages["dataset.upload_invalid_zip"],
        });
        form.setFieldsValue({ zipFile: null });
      },
    );
    return false;
  };

  render() {
    const { form, activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;
    const isDatasetManagerOrAdmin = this.isDatasetManagerOrAdmin();
    const { needsConversion } = this.state;
    const uploadableDatastores = datastores.filter(datastore => datastore.allowsUpload);
    const hasOnlyOneDatastoreOrNone = uploadableDatastores.length <= 1;

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <CardContainer withoutCard={withoutCard} title="Upload Dataset">
          <Form onSubmit={this.handleSubmit} layout="vertical">
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
                          this.setState({ selectedTeams: teamOfOrganisation });
                          form.setFieldsValue({
                            initialTeams: teamOfOrganisation,
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
                <br />
                Your dataset is not yet in WKW Format. Therefore you need to define the voxel size.
              </React.Fragment>
            ) : null}
            <FormItem label="Dataset ZIP File" hasFeedback>
              {getFieldDecorator("zipFile", {
                rules: [{ required: true, message: messages["dataset.import.required.zipFile"] }],
                valuePropName: "fileList",
                getValueFromEvent: this.normFile,
              })(
                <Upload.Dragger name="files" beforeUpload={this.handleFileDrop} listType="picture">
                  <p className="ant-upload-drag-icon">
                    <Icon type="inbox" style={{ margin: 0 }} />
                  </p>
                  <p className="ant-upload-text">
                    Click or Drag your ZIP File to this Area to Upload
                  </p>
                </Upload.Dragger>,
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

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(
  withRouter(Form.create()(DatasetUploadView)),
);
