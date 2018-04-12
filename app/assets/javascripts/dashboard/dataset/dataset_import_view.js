// @flow

import * as React from "react";
import {
  Button,
  Spin,
  Input,
  Checkbox,
  Alert,
  Form,
  Card,
  InputNumber,
  Collapse,
  Col,
  Row,
} from "antd";
import Clipboard from "clipboard-js";
import Request from "libs/request";
import update from "immutability-helper";
import Toast from "libs/toast";
import {
  doWithToken,
  getDatasetSharingToken,
  revokeDatasetSharingToken,
  getDataset,
  updateDataset,
  getDatasetDefaultConfiguration,
  updateDatasetDefaultConfiguration,
} from "admin/admin_rest_api";
import type { APIDatasetType } from "admin/api_flow_types";
import type { DatasetConfigurationType } from "oxalis/store";

const FormItem = Form.Item;
const CollapsePanel = Collapse.Panel;

const validateJSON = (rule, value, callback) => {
  try {
    JSON.parse(value);
    callback();
  } catch (e) {
    callback(true);
  }
};

const jsonEditStyle = {
  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
};

type Props = {
  form: Object,
  datasetName: string,
  isEditingMode: boolean,
};

type State = {
  sharingToken: string,
  dataset: ?APIDatasetType,
  datasetDefaultConfiguration: ?DatasetConfigurationType,
  isLoading: boolean,
  messages: Array<{ ["info" | "warning" | "error"]: string }>,
};

type FormData = {
  dataSourceJson: string,
  dataset: APIDatasetType,
  defaultConfiguration: DatasetConfigurationType,
  defaultConfigurationLayersJson: string,
};

class DatasetImportView extends React.PureComponent<Props, State> {
  state = {
    dataset: null,
    datasetDefaultConfiguration: null,
    sharingToken: "",
    isLoading: true,
    messages: [],
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    this.setState({ isLoading: true });
    const sharingToken = await getDatasetSharingToken(this.props.datasetName);
    const dataset = await getDataset(this.props.datasetName);
    const datasetDefaultConfiguration = await getDatasetDefaultConfiguration(
      this.props.datasetName,
    );

    const datasetJson = await doWithToken(token =>
      Request.receiveJSON(
        `${dataset.dataStore.url}/data/datasets/${this.props.datasetName}?token=${token}`,
      ),
    );

    this.props.form.setFieldsValue({
      dataSourceJson: JSON.stringify(datasetJson.dataSource, null, "  "),
      dataset: {
        isPublic: dataset.isPublic,
        description: dataset.description || undefined,
      },
      defaultConfiguration: datasetDefaultConfiguration,
      defaultConfigurationLayersJson: JSON.stringify(
        datasetDefaultConfiguration.layers,
        null,
        "  ",
      ),
    });

    // eslint-disable-next-line react/no-did-mount-set-state
    this.setState({
      isLoading: false,
      sharingToken,
      dataset,
      datasetDefaultConfiguration,
      messages: datasetJson.messages,
    });
  }

  importDataset = (e: SyntheticEvent<>) => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues: FormData) => {
      const { dataset, datasetDefaultConfiguration } = this.state;
      if (!err && dataset != null) {
        await updateDataset(this.props.datasetName, Object.assign({}, dataset, formValues.dataset));

        await updateDatasetDefaultConfiguration(
          this.props.datasetName,
          Object.assign({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
            layers: JSON.parse(formValues.defaultConfigurationLayersJson),
          }),
        );

        const dataSource = JSON.parse(formValues.dataSourceJson);
        await doWithToken(token =>
          Request.sendJSONReceiveJSON(
            `${dataset.dataStore.url}/data/datasets/${this.props.datasetName}?token=${token}`,
            {
              data: dataSource,
            },
          ),
        );
        const verb = this.props.isEditingMode ? "updated" : "imported";
        Toast.success(`Successfully ${verb} ${this.props.datasetName}`);
        // window.history.back();
      }
    });
  };

  handleCopySharingLink = async () => {
    await Clipboard.copy(this.getSharingLink());
    Toast.success("Sharing Link copied to clipboard");
  };

  handleRevokeSharingLink = async () => {
    this.setState({ isLoading: true });
    try {
      await revokeDatasetSharingToken(this.props.datasetName);
      const sharingToken = await getDatasetSharingToken(this.props.datasetName);
      this.setState({ sharingToken });
    } finally {
      this.setState({ isLoading: false });
    }
  };

  handleSelectText = (event: SyntheticInputEvent<>) => {
    event.target.select();
  };

  updateDataset(propertyName: string, value: string | boolean) {
    const newState = update(this.state, {
      dataset: { [propertyName]: { $set: value } },
    });
    this.setState(newState);
  }

  getSharingLink() {
    return `${window.location.origin}/datasets/${this.props.datasetName}/view?token=${
      this.state.sharingToken
    }`;
  }

  getMessageComponents() {
    const messageElements = this.state.messages.map((message, i) => (
      // eslint-disable-next-line react/no-array-index-key
      <Alert key={i} message={Object.values(message)[0]} type={Object.keys(message)[0]} showIcon />
    ));

    return <div>{messageElements}</div>;
  }

  getEditModeComponents() {
    const { getFieldDecorator } = this.props.form;
    // these components are only available in editing mode

    return (
      <div>
        <FormItem label="Description">
          {getFieldDecorator("dataset.description")(
            <Input.TextArea rows="3" placeholder="Dataset Description" />,
          )}
        </FormItem>
        <FormItem label="Display Name">
          {getFieldDecorator("defaultConfiguration.name", { rules: [{ len: 3 }] })(
            <Input placeholder="Dataset Display Name" />,
          )}
        </FormItem>
        <FormItem label="Sharing Link">
          <Input.Group compact>
            <Input
              value={this.getSharingLink()}
              onClick={this.handleSelectText}
              style={{ width: "80%" }}
              readOnly
            />
            <Button onClick={this.handleCopySharingLink} style={{ width: "10%" }} icon="copy" />
            <Button onClick={this.handleRevokeSharingLink} style={{ width: "10%" }}>
              Revoke
            </Button>
          </Input.Group>
        </FormItem>
        <FormItem>
          {getFieldDecorator("dataset.isPublic", { valuePropName: "checked" })(
            <Checkbox>Make dataset publicly accessible</Checkbox>,
          )}
        </FormItem>
        <Collapse defaultActiveKey={["1"]} bordered={false} style={{ marginBottom: 10 }}>
          <CollapsePanel header="Default Settings" key="1" style={{ borderBottom: "none" }}>
            <Row gutter={24}>
              <Col span={6}>
                <FormItem label="Position">
                  {getFieldDecorator("defaultConfiguration.position", {
                    rules: [
                      {
                        pattern: /\d+\w*,\w*\d+\w*,\w*\d+/,
                        message: "Please provide a valid position (e.g., 123,456,789)",
                      },
                    ],
                  })(<Input />)}
                </FormItem>
              </Col>
              <Col span={6}>
                <FormItem label="Zoom">
                  {getFieldDecorator("defaultConfiguration.zoom")(
                    <InputNumber style={{ width: "100%" }} />,
                  )}
                </FormItem>
              </Col>
              <Col span={6}>
                <FormItem label="Segmentation Opacity">
                  {getFieldDecorator("defaultConfiguration.segmentationOpacity")(
                    <InputNumber style={{ width: "100%" }} />,
                  )}
                </FormItem>
              </Col>
              <Col span={6}>
                <FormItem label=" " colon={false}>
                  {getFieldDecorator("defaultConfiguration.interpolation", {
                    valuePropName: "checked",
                  })(<Checkbox>Interpolation</Checkbox>)}
                </FormItem>
              </Col>
            </Row>
            <FormItem label="Layer Configuration">
              {getFieldDecorator("defaultConfigurationLayersJson", {
                rules: [
                  { validator: validateJSON, message: "Invalid JSON. Please fix the errors." },
                ],
              })(<Input.TextArea rows="10" style={jsonEditStyle} />)}
            </FormItem>
          </CollapsePanel>
        </Collapse>
      </div>
    );
  }

  render() {
    const { getFieldDecorator } = this.props.form;

    const titleString = this.props.isEditingMode ? "Update" : "Import";

    return (
      <Form className="row container dataset-import" onSubmit={this.importDataset}>
        <Card
          title={
            <h3>
              {titleString} Dataset: {this.props.datasetName}
            </h3>
          }
        >
          <Spin size="large" spinning={this.state.isLoading}>
            <p>Please review your dataset&#39;s properties before importing it.</p>
            {this.getMessageComponents()}
            <FormItem label="Dataset Configuration" hasFeedback>
              {getFieldDecorator("dataSourceJson", {
                rules: [
                  {
                    required: true,
                    message: "Please provide a dataset configuration.",
                  },
                  {
                    validator: validateJSON,
                    message: "Invalid JSON. Please fix the errors.",
                  },
                ],
              })(<Input.TextArea rows={20} style={jsonEditStyle} />)}
            </FormItem>
            {this.getEditModeComponents()}
            <FormItem>
              <Button type="primary" htmlType="submit">
                {titleString}
              </Button>&nbsp;
              <Button onClick={() => window.history.back()}>Cancel</Button>
            </FormItem>
          </Spin>
        </Card>
      </Form>
    );
  }
}

export default Form.create()(DatasetImportView);
