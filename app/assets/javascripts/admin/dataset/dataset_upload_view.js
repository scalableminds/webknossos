// @flow
import { Form, Input, Select, Button, Card, Spin, Upload, Icon, Col, Row } from "antd";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import React from "react";

import type { APIDataStore, APIUser, DatasetConfig } from "admin/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { getDatastores, addDataset, isDatasetNameValid } from "admin/admin_rest_api";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import messages from "messages";

const FormItem = Form.Item;
const { Option } = Select;

type StateProps = {
  activeUser: ?APIUser,
};

type Props = StateProps & {
  form: Object,
  withoutCard?: boolean,
  onUploaded: string => void,
};

type State = {
  datastores: Array<APIDataStore>,
  isUploading: boolean,
};

class DatasetUploadView extends React.PureComponent<Props, State> {
  state = {
    datastores: [],
    isUploading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    const datastores = await getDatastores();

    this.setState({
      datastores,
    });

    if (datastores.length > 0) {
      this.props.form.setFieldsValue({ datastore: datastores[0].url });
    }
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

        const datasetConfig: DatasetConfig = {
          ...formValues,
          organization: activeUser.organization,
        };

        addDataset(datasetConfig).then(
          async () => {
            Toast.success(messages["dataset.upload_success"]);
            await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
            this.props.onUploaded(formValues.name);
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

    const Container = ({ children }) => {
      if (this.props.withoutCard) {
        return <React.Fragment>{children}</React.Fragment>;
      } else {
        return (
          <Card
            style={{ width: "85%", marginLeft: "auto", marginRight: "auto" }}
            bordered={false}
            title={<h3>Upload Dataset</h3>}
          >
            {children}
          </Card>
        );
      }
    };
    return (
      <div className="dataset-administration" style={{ padding: 5 }}>
        <Spin spinning={this.state.isUploading} size="large">
          <Container>
            <Form onSubmit={this.handleSubmit} layout="vertical">
              <Row gutter={8}>
                <Col span={12}>
                  <FormItem label="Dataset Name" hasFeedback>
                    {getFieldDecorator("name", {
                      rules: [
                        { required: true, message: messages["dataset.import.required.name"] },
                        { min: 3 },
                        { pattern: /[0-9a-zA-Z_-]+$/ },
                        {
                          validator: async (_rule, value, callback) => {
                            if (!this.props.activeUser)
                              throw new Error("Can't do operation if no user is logged in.");
                            const reasons = await isDatasetNameValid({
                              name: value,
                              owningOrganization: this.props.activeUser.organization,
                            });
                            if (reasons != null) {
                              callback(reasons);
                            } else {
                              callback();
                            }
                          },
                        },
                      ],
                      validateFirst: true,
                    })(<Input autoFocus />)}
                  </FormItem>
                </Col>
                <Col span={12}>
                  <FormItem label="Datastore" hasFeedback>
                    {getFieldDecorator("datastore", {
                      rules: [
                        { required: true, message: messages["dataset.import.required.datastore"] },
                      ],
                    })(
                      <Select
                        showSearch
                        placeholder="Select a Datastore"
                        optionFilterProp="children"
                        style={{ width: "100%" }}
                      >
                        {this.state.datastores.map((datastore: APIDataStore) => (
                          <Option key={datastore.name} value={datastore.url}>
                            {`${datastore.name}`}
                          </Option>
                        ))}
                      </Select>,
                    )}
                  </FormItem>
                </Col>
              </Row>
              <FormItem label="Dataset ZIP File" hasFeedback>
                {getFieldDecorator("zipFile", {
                  rules: [{ required: true, message: messages["dataset.import.required.zipFile"] }],
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
          </Container>
        </Spin>
      </div>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  activeUser: state.activeUser,
});

export default connect(mapStateToProps)(withRouter(Form.create()(DatasetUploadView)));
