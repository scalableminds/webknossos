// @flow
import { Form, Button, Spin, Upload, Icon, Col, Row, Tooltip, Modal, Progress } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { APIDataStore, APIUser, APIDatasetId } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { Vector3 } from "oxalis/constants";
import { finishDatasetUpload, createResumableUpload } from "admin/admin_rest_api";
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
import { type RouterHistory, withRouter } from "react-router-dom";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import features from "features";
import { syncValidator } from "types/validation";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  withoutCard?: boolean,
  onUploaded?: (string, string, boolean, ?Vector3) => Promise<void>,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithForm = {|
  ...Props,
  history: RouterHistory,
  form: Object,
|};

type State = {
  isUploading: boolean,
  needsConversion: boolean,
  isRetrying: boolean,
  isFinished: boolean,
  showAfterUploadContent: boolean,
  uploadProgress: number,
};

class DatasetUploadView extends React.PureComponent<PropsWithForm, State> {
  state = {
    isUploading: false,
    needsConversion: false,
    isRetrying: false,
    isFinished: false,
    showAfterUploadContent: false,
    uploadProgress: 0,
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

        const datasetId: APIDatasetId = {
          name: formValues.name,
          owningOrganization: activeUser.organization,
        };

        const resumableUpload = await createResumableUpload(datasetId, formValues.datastore);

        resumableUpload.on("fileSuccess", file => {
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
              this.setState({ showAfterUploadContent: true, isFinished: true });
              if (this.props.onUploaded != null) {
                this.props.onUploaded(
                  activeUser.organization,
                  formValues.name,
                  this.state.needsConversion,
                  formValues.scale,
                );
              }
              /*
              Questions: The behaviour of onUploaded is not the same. 
              In the onboarding after upload the dataset setting are opened in a modal.
              In the add dataset view the user gets redirected to the jobs view if conversion needs to be done 
              or to the dataset settings of the just uploaded dataset.
              Doesn't the onboarding case also need the conversion job?
              I would like to overwrite the behaviour for the add dataset view: open a modal and ask the user what he wants to do.
              */
            },
            () => {
              Toast.error(messages["dataset.upload_failed"]);
              this.setState({
                isUploading: false,
                isFinished: false,
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
    let modalContent = null;
    const { form, history, activeUser } = this.props;
    const {
      isRetrying,
      isFinished,
      uploadProgress,
      isUploading,
      showAfterUploadContent,
    } = this.state;
    if (isFinished && !showAfterUploadContent) {
      modalContent = (
        <React.Fragment>
          <Icon type="folder" style={{ fontSize: 20 }} />
          <br />
          Converting Dataset {form.getFieldValue("name")}.
          <br />
          <Spin size="large" />
        </React.Fragment>
      );
    } else if (!showAfterUploadContent) {
      modalContent = (
        <React.Fragment>
          <Icon type="folder" style={{ fontSize: 50 }} />
          <br />
          {isRetrying
            ? `Upload of dataset ${form.getFieldValue("name")} froze.`
            : `Uploading Dataset ${form.getFieldValue("name")}.`}
          <br />
          {isRetrying ? "Retrying to continue the upload..." : null}
          <br />
          <Progress
            strokeColor={{
              from: "#108ee9",
              to: "#87d068",
            }}
            // Round to 1 digit after the comma.
            percent={Math.round(uploadProgress * 1000) / 10}
            status="active"
          />
        </React.Fragment>
      );
    } else {
      // The content to show upon successful dataset upload.
      const datasetName = form.getFieldValue("name");
      if (activeUser != null) {
        modalContent = (
          <React.Fragment>
            The dataset was successfully uploaded.
            <br />
            You can now:
            <table style={{ borderSpacing: 12, borderCollapse: "separate" }}>
              <tbody>
                <tr>
                  <td>• Edit the Settings of the Dataset</td>
                  <td>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() =>
                        history.push(`/datasets/${activeUser.organization}/${datasetName}/import`)
                      }
                    >
                      Settings
                    </Button>
                  </td>
                </tr>
                <tr>
                  <td>• Go back to the dataset list in the dashboard</td>
                  <td>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() => history.push("/dashboard/datasets")}
                    >
                      Dashboard
                    </Button>
                  </td>
                </tr>
                <tr>
                  <td>• View the dataset and start a tracing from there</td>
                  <td>
                    <Button
                      type="primary"
                      size="small"
                      onClick={() =>
                        history.push(`/datasets/${activeUser.organization}/${datasetName}/view`)
                      }
                    >
                      View
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </React.Fragment>
        );
      }
    }
    /* const title = showAfterUploadContent
      ? `Uploading of Dataset ${form.getFieldValue("name")} succeeded`
      : `Uploading to ${form.getFieldValue("datastore")}`; */
    return (
      <Modal
        visible={isUploading}
        closable={showAfterUploadContent}
        keyboard={showAfterUploadContent}
        maskClosable={showAfterUploadContent}
        cancelButtonProps={{ style: { display: "none" } }}
        okButtonProps={{ disabled: !showAfterUploadContent }}
        onOk={() => {
          form.setFieldsValue({ name: null, zipFile: null });
          this.setState({ isUploading: false, showAfterUploadContent: false });
        }}
      >
        {modalContent}
      </Modal>
    );
  };

  handleFileDrop = file => {
    const { form } = this.props;
    if (!form.getFieldValue("name")) {
      const filename = file.name
        .split(".")
        .slice(0, -1)
        .join(".");
      form.setFieldsValue({ name: filename });
      form.validateFields(["name"]);
    }
    file.thumbUrl = "/assets/images/folder.svg";
    const blobReader = new BlobReader(file);
    createReader(
      blobReader,
      async reader => {
        // get all entries from the zip
        reader.getEntries(entries => {
          const wkwFile = entries.find(entry =>
            Utils.isFileExtensionEqualTo(entry.filename, "wkw"),
          );
          const isNotWkwFormat = wkwFile == null;
          this.setState({
            needsConversion: isNotWkwFormat,
          });
          if (isNotWkwFormat && !features().jobsEnabled) {
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
            form.setFieldsValue({ zipFile: null });
          } else {
            form.setFieldsValue({ zipFile: [file] });
          }
        });
      },
      () => {
        Modal.error({
          content:
            "It looks like your selected file is not a valid zip file. Please ensure that your dataset is zipped to a single file and that the format is correct.",
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
                        onChange={selectedTeams =>
                          form.setFieldsValue({ initialTeams: selectedTeams })
                        }
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
