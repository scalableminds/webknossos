// @flow

import * as React from "react";
import _ from "lodash";
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
import update from "immutability-helper";
import jsonschema from "jsonschema";
import Toast from "libs/toast";
import {
  getDatasetSharingToken,
  revokeDatasetSharingToken,
  getDataset,
  updateDataset,
  getDatasetDefaultConfiguration,
  updateDatasetDefaultConfiguration,
  getDatasetDatasource,
  updateDatasetDatasource,
  updateDatasetTeams,
} from "admin/admin_rest_api";
import { Vector3Input } from "libs/vector_input";
import type { DatasetConfigurationType } from "oxalis/store";
import messages from "messages";
import type { APIDatasetType, APIMessageType } from "admin/api_flow_types";
import DatasourceSchema from "libs/datasource.schema.json";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { handleGenericError } from "libs/error_handling";

const FormItem = Form.Item;
const CollapsePanel = Collapse.Panel;

const validator = new jsonschema.Validator();
validator.addSchema(DatasourceSchema, "/");

const validateWithSchema = (type: string) => (rule, value, callback) => {
  try {
    const json = JSON.parse(value);
    const result = validator.validate(json, {
      $ref: `#/definitions/${type}`,
    });
    if (result.valid) {
      callback();
    } else {
      callback(
        new Error(
          `Invalid schema: ${result.errors.map(e => `${e.property} ${e.message}`).join("; ")}`,
        ),
      );
    }
  } catch (e) {
    callback(new Error(`Invalid JSON: ${e.message}`));
  }
};

const validateDatasourceJSON = validateWithSchema("types::DatasourceConfiguration");
const validateLayerConfigurationJSON = validateWithSchema("types::LayerUserConfiguration");

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
  messages: Array<APIMessageType>,
  isLoading: boolean,
};

type FormData = {
  dataSourceJson: string,
  dataset: APIDatasetType,
  defaultConfiguration: DatasetConfigurationType,
  defaultConfigurationLayersJson: string,
};

class DatasetImportView extends React.PureComponent<Props, State> {
  static defaultProps = {
    isEditingMode: false,
  };

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
    try {
      this.setState({ isLoading: true });
      const [sharingToken, dataset] = await Promise.all([
        getDatasetSharingToken(this.props.datasetName),
        getDataset(this.props.datasetName),
      ]);
      const { dataSource, messages: dataSourceMessages } = await getDatasetDatasource(dataset);

      this.props.form.setFieldsValue({
        dataSourceJson: JSON.stringify(dataSource, null, "  "),
        dataset: {
          displayName: dataset.displayName || undefined,
          isPublic: dataset.isPublic || false,
          description: dataset.description || undefined,
          allowedTeams: dataset.allowedTeams || [],
        },
      });

      if (this.props.isEditingMode) {
        const datasetDefaultConfiguration = await getDatasetDefaultConfiguration(
          this.props.datasetName,
        );
        this.props.form.setFieldsValue({
          defaultConfiguration: datasetDefaultConfiguration,
          defaultConfigurationLayersJson: JSON.stringify(
            datasetDefaultConfiguration.layers,
            null,
            "  ",
          ),
        });
        this.setState({ datasetDefaultConfiguration });
      }

      this.setState({
        sharingToken,
        dataset,
        messages: dataSourceMessages,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleSubmit = (e: SyntheticEvent<>) => {
    e.preventDefault();
    this.props.form.validateFields(async (err, formValues: FormData) => {
      const { dataset, datasetDefaultConfiguration } = this.state;
      if (!err && dataset != null) {
        await updateDataset(this.props.datasetName, Object.assign({}, dataset, formValues.dataset));

        if (datasetDefaultConfiguration != null) {
          await updateDatasetDefaultConfiguration(
            this.props.datasetName,
            _.extend({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
              layers: JSON.parse(formValues.defaultConfigurationLayersJson),
            }),
          );
        }

        const dataSource = JSON.parse(formValues.dataSourceJson);
        await updateDatasetDatasource(this.props.datasetName, dataset.dataStore.url, dataSource);

        const teamIds = formValues.dataset.allowedTeams.map(t => t.id);
        await updateDatasetTeams(dataset.name, teamIds);

        const verb = this.props.isEditingMode ? "updated" : "imported";
        Toast.success(`Successfully ${verb} ${this.props.datasetName}`);
        window.history.back();
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

    if (this.state.dataset != null && this.state.dataset.dataSource.status != null) {
      const statusMessage = (
        <span>
          {messages["dataset.invalid_datasource_json"]}
          <br />
          {this.state.dataset.dataSource.status}
        </span>
      );
      messageElements.push(
        <Alert key="datasourceStatus" message={statusMessage} type="error" showIcon />,
      );
    }

    return <div>{messageElements}</div>;
  }

  getEditModeComponents() {
    const { getFieldDecorator } = this.props.form;
    return (
      <div>
        <FormItem label="Description">
          {getFieldDecorator("dataset.description")(
            <Input.TextArea rows="3" placeholder="Description" />,
          )}
        </FormItem>
        <FormItem label="Display Name">
          {getFieldDecorator("dataset.displayName")(<Input placeholder="Display Name" />)}
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
                  {getFieldDecorator("defaultConfiguration.position")(
                    <Vector3Input value="" onChange={() => {}} />,
                  )}
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
                rules: [{ validator: validateLayerConfigurationJSON }],
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
      <Form className="row container dataset-import" onSubmit={this.handleSubmit}>
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
                    validator: validateDatasourceJSON,
                  },
                ],
              })(<Input.TextArea rows={20} style={jsonEditStyle} />)}
            </FormItem>
            {this.props.isEditingMode ? this.getEditModeComponents() : null}
            <FormItem label="Allowed Teams">
              {getFieldDecorator("dataset.allowedTeams", {})(
                <TeamSelectionComponent mode="multiple" />,
              )}
            </FormItem>
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
