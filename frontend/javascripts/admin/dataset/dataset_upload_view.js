// @flow
import { Form, Button, Spin, Upload, Icon, Col, Row } from "antd";
import { connect } from "react-redux";
import React from "react";

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
            trackAction("Upload dataset");
            await Utils.sleep(3000); // wait for 3 seconds so the server can catch up / do its thing
            this.props.onUploaded(activeUser.organization, formValues.name);
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
              <FormItem label="Dataset ZIP File" hasFeedback>
                {getFieldDecorator("zipFile", {
                  rules: [{ required: true, message: messages["dataset.import.required.zipFile"] }],
                  valuePropName: "fileList",
                  getValueFromEvent: this.normFile,
                })(
                  <Upload.Dragger
                    name="files"
                    beforeUpload={file => {
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
