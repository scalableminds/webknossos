// @flow
import React from "react";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import { Form, Input, Select, Button, Card, Spin, Upload, Icon } from "antd";
import Toast from "libs/toast";
import messages from "messages";
import Utils from "libs/utils";
import { getEditableTeams, getDatastores, addDataset } from "admin/admin_rest_api";
import { getActiveUser } from "oxalis/model/accessors/user_accessor";
import type { APITeamType, APIDatastoreType, APIUserType } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import type { RouterHistory } from "react-router-dom";

const FormItem = Form.Item;
const Option = Select.Option;

type StateProps = {
  activeUser: APIUserType,
};

type Props = {
  form: Object,
  history: RouterHistory,
} & StateProps;

type State = {
  teams: Array<APITeamType>,
  datastores: Array<APIDatastoreType>,
  isUploading: boolean,
};

class DatasetUploadView extends React.PureComponent<Props, State> {
  state = {
    teams: [],
    datastores: [],
    isUploading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const datastores = await getDatastores();
    const teams = await getEditableTeams();

    this.setState({
      datastores,
      teams,
    });
  }

  normFile = e => {
    if (Array.isArray(e)) {
      return e;
    }
    return e && e.fileList;
  };

  handleSubmit = evt => {
    evt.preventDefault();

    this.props.form.validateFields(async (err, formValues) => {
      if (!err) {
        Toast.info("Uploading datasets");
        this.setState({
          isUploading: true,
        });

        addDataset(formValues).then(
          async () => {
            Toast.success(messages["dataset.upload_success"]);
            await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
            const url = `/datasets/${formValues.name}/import`;
            this.props.history.push(url);
          },
          () => {
            this.setState({ isUploading: false });
          },
        );
      }
    });
  };

  render() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <Spin spinning={this.state.isUploading} size="large">
          <Card title={<h3>Upload Dataset</h3>}>
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <FormItem label="Dataset Name" hasFeedback>
                {getFieldDecorator("name", {
                  rules: [{ required: true }, { min: 3 }, { pattern: /[0-9a-zA-Z_-]+$/ }],
                })(<Input autoFocus />)}
              </FormItem>

              <FormItem label="Team" hasFeedback>
                {getFieldDecorator("team", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a Team"
                    optionFilterProp="children"
                    style={{ width: "100%" }}
                  >
                    {this.state.teams.map((team: APITeamType) => (
                      <Option key={team.id} value={team.id}>
                        {`${team.name}`}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Datastore" hasFeedback>
                {getFieldDecorator("datastore", {
                  rules: [{ required: true }],
                })(
                  <Select
                    showSearch
                    placeholder="Select a Team"
                    optionFilterProp="children"
                    style={{ width: "100%" }}
                  >
                    {this.state.datastores.map((datastore: APIDatastoreType) => (
                      <Option key={datastore.name} value={datastore.url}>
                        {`${datastore.name}`}
                      </Option>
                    ))}
                  </Select>,
                )}
              </FormItem>

              <FormItem label="Dataset ZIP File" hasFeedback>
                {getFieldDecorator("zipFile", {
                  rules: [{ required: true }],
                  valuePropName: "fileList",
                  getValueFromEvent: this.normFile,
                })(
                  <Upload.Dragger
                    name="files"
                    beforeUpload={file => {
                      this.props.form.setFieldsValue({ zipFile: [file] });
                      return false;
                    }}
                  >
                    <p className="ant-upload-drag-icon">
                      <Icon type="inbox" />
                    </p>
                    <p className="ant-upload-text">Click or Drag File to This Area to Upload</p>
                  </Upload.Dragger>,
                )}
              </FormItem>

              <FormItem>
                <Button type="primary" htmlType="submit">
                  Upload
                </Button>
              </FormItem>
            </Form>
          </Card>
        </Spin>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: getActiveUser(state.activeUser),
});

export default connect(mapStateToProps)(withRouter(Form.create()(DatasetUploadView)));
