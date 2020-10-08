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
};

class DatasetUploadView extends React.PureComponent<PropsWithForm, State> {
  state = {
    isUploading: false,
  };

  isDatasetManagerOrAdmin = () =>
    this.props.activeUser &&
    (this.props.activeUser.isAdmin || this.props.activeUser.isDatasetManager);

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  handleSubmit = evt => {
    evt.preventDefault();

    this.props.form.validateFields(async (err, formValues) => {
      const { activeUser } = this.props;

      // Workaround: Antd replaces file objects in the formValues with a wrapper file
      // The original file object is contained in the originFileObj property
      // This is most likely not intentional and may change in a future Antd version
      formValues.zipFile = formValues.zipFile.map(wrapperFile => wrapperFile.originFileObj);
      formValues.initialTeams = formValues.initialTeams.map(team => team.id);

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

        resumableUpload.on("fileSuccess", (file) => {
          const uploadInfo = {
            uploadId: file.uniqueIdentifier,
            organization: datasetId.owningOrganization,
            name: datasetId.name,
            initialTeams: formValues.initialTeams,
          };

          finishDatasetUpload(formValues.datastore, uploadInfo).then(
            async () => {
              Toast.success(messages["dataset.upload_success"]);
              trackAction("Upload dataset");
              await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
              this.props.onUploaded(activeUser.organization, formValues.name);
            },
            () => {
              this.setState({ isUploading: false });
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

        resumableUpload.addFiles(formValues.zipFile);
      }
    });
  };

  render() {
    const { form, activeUser, withoutCard, datastores } = this.props;
    const { getFieldDecorator } = form;
    const isDatasetManagerOrAdmin = this.isDatasetManagerOrAdmin();

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <Spin spinning={this.state.isUploading} size="large">
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
