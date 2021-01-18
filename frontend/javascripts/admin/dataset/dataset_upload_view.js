// @flow
import {
  Form,
  Button,
  Spin,
  Upload,
  Icon,
  Col,
  Row,
  Tooltip,
  Checkbox,
  Modal,
  Progress,
} from "antd";
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
  onUploaded: (string, string, boolean, ?Vector3) => Promise<void>,
|};
type StateProps = {|
  activeUser: ?APIUser,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithForm = {|
  ...Props,
  form: Object,
|};

type State = {
  isUploading: boolean,
  needsConversion: boolean,
  isRetrying: boolean,
  isFinished: boolean,
  uploadProgress: number,
};

class DatasetUploadView extends React.PureComponent<PropsWithForm, State> {
  state = {
    isUploading: false,
    needsConversion: false,
    isRetrying: false,
    isFinished: false,
    uploadProgress: 0,
  };

  static getDerivedStateFromProps(props) {
    if (
      props.datastores.length === 1 &&
      props.form.getFieldValue("datastore") !== props.datastores[0].url
    ) {
      console.log("updating", props.form.getFieldValue("datastore"), props.datastores[0].url);
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

  handleCheckboxChange = evt => {
    this.setState({ needsConversion: evt.target.checked });
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
          return;
          this.setState({ isFinished: true });
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
              this.props.onUploaded(
                activeUser.organization,
                formValues.name,
                this.state.needsConversion,
                formValues.scale,
              );
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

  getUploadModalContent = () => {
    let modalContent = null;
    const { form } = this.props;
    const { isRetrying, isFinished, uploadProgress } = this.state;
    if (isFinished) {
      modalContent = (
        <React.Fragment>
          <Icon type="folder" style={{ fontSize: 20 }} />
          <br />
          Converting Dataset {form.getFieldValue("name")}.
          <br />
          <Spin size="large" />
        </React.Fragment>
      );
    } else {
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
    }
    return modalContent;
  };

  render() {
    const { form, activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;
    const isDatasetManagerOrAdmin = this.isDatasetManagerOrAdmin();
    const { isUploading } = this.state;
    const uploadableDatastores = datastores.filter(datastore => datastore.allowsUpload);
    const hasOnlyOneDatastore = uploadableDatastores.length === 1;

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <CardContainer withoutCard={withoutCard} title="Upload Dataset">
          <Form onSubmit={this.handleSubmit} layout="vertical">
            <Row gutter={8}>
              <Col span={hasOnlyOneDatastore ? 24 : 12}>
                <DatasetNameFormItem form={form} activeUser={activeUser} />
              </Col>
              <Col span={hasOnlyOneDatastore ? 0 : 12}>
                <DatastoreFormItem
                  form={form}
                  datastores={uploadableDatastores}
                  hidden={hasOnlyOneDatastore}
                />
              </Col>
            </Row>
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
                    onChange={selectedTeams => form.setFieldsValue({ initialTeams: selectedTeams })}
                  />
                </Tooltip>,
              )}
            </FormItem>
            {features().jobsEnabled && (
              <FormItemWithInfo
                label="Convert"
                info="If your dataset is not yet in WKW or KNOSSOS format, it needs to be converted."
              >
                {getFieldDecorator("needsConversion", {
                  initialValue: false,
                })(
                  <Checkbox
                    checked={this.state.needsConversion}
                    onChange={evt => {
                      this.handleCheckboxChange(evt);
                      form.setFieldsValue({ needsConversion: this.state.needsConversion });
                    }}
                  >
                    Needs Conversion
                  </Checkbox>,
                )}
              </FormItemWithInfo>
            )}
            {this.state.needsConversion && (
              <FormItemWithInfo
                label="Voxel Size"
                info="The voxel size defines the extent (for x, y, z) of one voxel in nanometer."
                disabled={this.state.needsConversion}
              >
                {getFieldDecorator("scale", {
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
            )}
            <FormItem label="Dataset ZIP File" hasFeedback>
              {getFieldDecorator("zipFile", {
                rules: [{ required: true, message: messages["dataset.import.required.zipFile"] }],
                valuePropName: "fileList",
                getValueFromEvent: this.normFile,
              })(
                <Upload.Dragger
                  name="files"
                  beforeUpload={file => {
                    if (!form.getFieldValue("name")) {
                      const filename = file.name
                        .split(".")
                        .slice(0, -1)
                        .join(".");
                      form.setFieldsValue({ name: filename });
                      form.validateFields(["name"]);
                    }
                    file.thumbUrl = "/assets/images/folder.svg";
                    form.setFieldsValue({ zipFile: [file] });

                    return false;
                  }}
                  listType="picture"
                >
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
        <Modal
          title={`Uploading to ${form.getFieldValue("datastore")}`}
          visible={isUploading}
          cancelButtonProps={{ style: { display: "none" } }}
          okButtonProps={{ disabled: true }}
        >
          {this.getUploadModalContent()}
        </Modal>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(
  Form.create()(DatasetUploadView),
);
