// @flow
import { Form, Button, Spin, Upload, Icon, Col, Row, Tooltip, Checkbox } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";

import type { APIDataStore, APIUser, DatasetConfig } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { addDataset } from "admin/admin_rest_api";
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
import { syncValidator } from "../../dashboard/dataset/validation";
import { FormItemWithInfo } from "../../dashboard/dataset/helper_components";

const FormItem = Form.Item;

type OwnProps = {|
  datastores: Array<APIDataStore>,
  withoutCard?: boolean,
  onUploaded: (string, string, boolean) => void,
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
};

class DatasetUploadView extends React.PureComponent<PropsWithForm, State> {
  state = {
    isUploading: false,
    needsConversion: false,
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
      formValues.initialTeams = formValues.initialTeams.map(team => team.id);

      if (!err && activeUser != null) {
        Toast.info("Uploading datasets");
        this.setState({
          isUploading: true,
        });

        const datasetConfig: DatasetConfig = {
          ...formValues,
          organization: activeUser.organization,
        };

        addDataset(datasetConfig).then(
          async () => {
            Toast.success(messages["dataset.upload_success"]);
            trackAction("Upload dataset");
            await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
            this.props.onUploaded(
              activeUser.organization,
              formValues.name,
              this.state.needsConversion,
            );
          },
          () => {
            this.setState({ isUploading: false });
          },
        );
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
              <FormItemWithInfo label="Conversion" info="Info">
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
                          "Each component of the scale must be larger than 0",
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
