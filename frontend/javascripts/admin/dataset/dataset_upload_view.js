// @flow
import { Form, Button, Spin, Upload, Icon, Col, Row, Tooltip } from "antd";
import { connect } from "react-redux";
import React from "react";

import type { APIDataStore, APIUser, APIDatasetId } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
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
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  withoutCard?: boolean,
  onUploaded: (string, string) => void,
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
  isRetrying: boolean,
  isFinished: boolean,
  uploadProgress: number,
};

class DatasetUploadView extends React.PureComponent<PropsWithForm, State> {
  state = {
    isUploading: false,
    isRetrying: false,
    isFinished: false,
    uploadProgress: 0,
  };

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
        Toast.info("Uploading datasets");
        this.setState({
          isUploading: true,
        });

        const datasetId: APIDatasetId = {
          name: formValues.name,
          owningOrganization: activeUser.organization,
        };

        const resumableUpload = await createResumableUpload(datasetId, formValues.datastore);

        resumableUpload.on("fileSuccess", file => {
          this.setState({ isFinished: true });
          const uploadInfo = {
            uploadId: file.uniqueIdentifier,
            organization: datasetId.owningOrganization,
            name: datasetId.name,
            initialTeams: formValues.initialTeams.map(team => team.id),
          };

          finishDatasetUpload(formValues.datastore, uploadInfo).then(
            async () => {
              Toast.success(messages["dataset.upload_success"]);
              trackAction("Upload dataset");
              await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
              this.props.onUploaded(activeUser.organization, formValues.name);
            },
            () => {
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

  render() {
    const { form, activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;
    const isDatasetManagerOrAdmin = this.isDatasetManagerOrAdmin();
    const { isUploading, isRetrying, isFinished, uploadProgress } = this.state;
    let tooltip;
    if (isFinished) {
      tooltip = "Converting Dataset...";
    } else {
      tooltip = `${isRetrying ? "Retrying... - " : ""}${Math.round(
        uploadProgress * 100,
      )}% completed`;
    }

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <Spin spinning={isUploading} tip={tooltip} size="large">
          <CardContainer withoutCard={withoutCard} title="Upload Dataset">
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <Row gutter={8}>
                <Col span={12}>
                  <DatasetNameFormItem form={form} activeUser={activeUser} />
                </Col>
                <Col span={12}>
                  <DatastoreFormItem
                    form={form}
                    datastores={datastores.filter(datastore => datastore.allowsUpload)}
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
                      onChange={selectedTeams =>
                        form.setFieldsValue({ initialTeams: selectedTeams })
                      }
                    />
                  </Tooltip>,
                )}
              </FormItem>
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
                      form.setFieldsValue({ zipFile: [file] });

                      return false;
                    }}
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
        </Spin>
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
