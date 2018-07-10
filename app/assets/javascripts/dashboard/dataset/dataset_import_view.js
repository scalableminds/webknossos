// @flow

import * as React from "react";
import _ from "lodash";
import {
  Button,
  Spin,
  Collapse,
  Input,
  Checkbox,
  Alert,
  Form,
  Card,
  InputNumber,
  Col,
  Row,
  Tabs,
  Switch,
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
import { Vector3Input, BoundingBoxInput } from "libs/vector_input";
import type { DatasetConfigurationType } from "oxalis/store";
import messages from "messages";
import type {
  APIDatasetType,
  APIMessageType,
  APIDataSourceWithMessagesType,
} from "admin/api_flow_types";
import DatasourceSchema from "libs/datasource.schema.json";
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { handleGenericError } from "libs/error_handling";
import { getBitDepth } from "oxalis/model/accessors/dataset_accessor";

const FormItem = Form.Item;
const TabPane = Tabs.TabPane;
const Panel = Collapse.Panel;

const validator = new jsonschema.Validator();
validator.addSchema(DatasourceSchema, "/");

const toJSON = json => JSON.stringify(json, null, "  ");
const isValidJSON = json => {
  try {
    JSON.parse(json);
    return true;
  } catch (ex) {
    return false;
  }
};

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
  activeDataSourceEditTab: "simple" | "advanced",
};

type FormData = {
  dataSource: APIDataSourceWithMessagesType,
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
    activeDataSourceEditTab: "simple",
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
      console.log("dataSource", dataSource);

      setTimeout(() => {
        this.props.form.setFieldsValue({
          dataSourceJson: toJSON(dataSource),
          dataset: {
            displayName: dataset.displayName || undefined,
            isPublic: dataset.isPublic || false,
            description: dataset.description || undefined,
            allowedTeams: dataset.allowedTeams || [],
          },
        });
      }, 100);
      setTimeout(() => {
        this.props.form.setFieldsValue({
          dataSource,
        });
      }, 200);

      if (this.props.isEditingMode) {
        const datasetDefaultConfiguration = await getDatasetDefaultConfiguration(
          this.props.datasetName,
        );
        setTimeout(() => {
          this.props.form.setFieldsValue({
            defaultConfiguration: datasetDefaultConfiguration,
            defaultConfigurationLayersJson: JSON.stringify(
              datasetDefaultConfiguration.layers,
              null,
              "  ",
            ),
          });
        }, 100);
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
      this.props.form.validateFields();
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

  getGeneralComponents() {
    const { getFieldDecorator } = this.props.form;
    const allowedTeamsComponent = (
      <FormItem label="Allowed Teams">
        {getFieldDecorator("dataset.allowedTeams", {})(<TeamSelectionComponent mode="multiple" />)}
      </FormItem>
    );
    const content = !this.props.isEditingMode ? (
      allowedTeamsComponent
    ) : (
      <div>
        <Row gutter={48}>
          <Col span={12}>
            <FormItem label="Display Name">
              {getFieldDecorator("dataset.displayName")(<Input placeholder="Display Name" />)}
            </FormItem>
          </Col>
          <Col span={12}>
            <FormItem label="Description">
              {getFieldDecorator("dataset.description")(
                <Input.TextArea rows="3" placeholder="Description" />,
              )}
            </FormItem>
          </Col>
        </Row>
        {allowedTeamsComponent}
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
      </div>
    );

    return content;
  }

  getDefaultConfigComponents() {
    const { getFieldDecorator } = this.props.form;

    return (
      <div>
        <Row gutter={24}>
          <Col span={6}>
            <FormItem label="Position">
              {getFieldDecorator("defaultConfiguration.position")(<Vector3Input />)}
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
      </div>
    );
  }

  getDataComponents() {
    const { getFieldDecorator } = this.props.form;
    const dataLayers =
      this.props.form.getFieldValue("dataSourceJson") &&
      isValidJSON(this.props.form.getFieldValue("dataSourceJson"))
        ? JSON.parse(this.props.form.getFieldValue("dataSourceJson")).dataLayers
        : [];

    return (
      <Collapse
        accordion
        bordered={false}
        activeKey={this.state.activeDataSourceEditTab}
        onChange={key => {
          const parsedConfig = JSON.parse(this.props.form.getFieldValue("dataSourceJson"));
          if (key === "advanced") {
            // Simple --> advanced: update json

            // parsedConfig has to be taken into account, since `dataSource` will only
            // contain the fields that antd has registered input elements for
            const newDataSource = parsedConfig;
            _.merge(newDataSource, this.props.form.getFieldValue("dataSource"));
            this.props.form.setFieldsValue({
              dataSourceJson: toJSON(newDataSource),
            });
          } else {
            // Advanced --> simple: update form values
            this.props.form.setFieldsValue({
              dataSource: parsedConfig,
            });
          }
          this.setState({ activeDataSourceEditTab: key });
        }}
      >
        <Panel header="Simple" key="simple" forceRender>
          <FormItem label="Scale (x, y, z)">
            {getFieldDecorator("dataSource.scale", {
              rules: [
                {
                  required: true,
                  message: "Please provide a scale for the dataset.",
                },
                {
                  validator: (rule, value, callback) =>
                    value && value.every(el => el > 0)
                      ? callback()
                      : callback(new Error("Each component of the scale must be larger than 0")),
                },
              ],
            })(<Vector3Input style={{ width: 400 }} />)}
          </FormItem>

          {dataLayers.map((layer, idx) => {
            const isSegmentation = layer.category === "segmentation";
            const bitDepth = getBitDepth(layer);
            return (
              <Row gutter={48} key={`layer-${idx}`}>
                <Col span={isSegmentation ? 12 : 24}>
                  <FormItem label={`Bounding box for ${layer.name}`}>
                    {getFieldDecorator(
                      layer.dataFormat === "knossos"
                        ? `dataSource.dataLayers[${idx}].sections[0].boundingBox`
                        : `dataSource.dataLayers[${idx}].boundingBox`,
                      {
                        rules: [
                          {
                            required: true,
                            message:
                              "Please define a bounding box in the format x, y, z, width, height, depth.",
                          },
                        ],
                      },
                    )(<BoundingBoxInput style={{ width: 400 }} />)}
                  </FormItem>
                </Col>

                {isSegmentation ? (
                  <Col span={12}>
                    <FormItem label={`Largest segment ID for ${layer.name}`}>
                      {getFieldDecorator(`dataSource.dataLayers[${idx}].largestSegmentId`, {
                        rules: [
                          {
                            required: true,
                            message:
                              "Please provide a largest segment ID for the segmentation layer",
                          },
                          {
                            validator: (rule, value, callback) =>
                              value > 0 && value < 2 ** bitDepth
                                ? callback()
                                : callback(
                                    new Error(
                                      `The largest segmentation ID must be larger than 0 and smaller than 2^${bitDepth}`,
                                    ),
                                  ),
                          },
                        ],
                      })(<InputNumber />)}
                    </FormItem>
                  </Col>
                ) : null}
              </Row>
            );
          })}
        </Panel>

        <Panel header="Advanced" key="advanced" forceRender>
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
        </Panel>
      </Collapse>
    );
  }

  render() {
    const { getFieldDecorator } = this.props.form;

    const titleString = this.props.isEditingMode ? "Update" : "Import";

    return (
      <Form className="row container dataset-import" onSubmit={this.handleSubmit}>
        <Card
          bordered={false}
          title={
            <h3>
              {titleString} Dataset: {this.props.datasetName}
            </h3>
          }
        >
          <Spin size="large" spinning={this.state.isLoading}>
            <p>Please review your dataset&#39;s properties before importing it.</p>
            {this.getMessageComponents()}

            <Card>
              <Tabs>
                <TabPane tab="Data" key="data" forceRender>
                  {this.getDataComponents()}
                </TabPane>
                <TabPane tab="General" key="general" forceRender>
                  {this.getGeneralComponents()}
                </TabPane>
                {this.props.isEditingMode ? (
                  <TabPane tab="Default Config" key="defaultConfig" forceRender>
                    {this.getDefaultConfigComponents()}
                  </TabPane>
                ) : null}
              </Tabs>
            </Card>
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
