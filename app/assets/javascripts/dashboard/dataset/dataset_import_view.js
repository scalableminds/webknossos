// @flow

import * as React from "react";
import _ from "lodash";
import {
  Button,
  Spin,
  Icon,
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
  Tooltip,
} from "antd";
import Clipboard from "clipboard-js";
import update from "immutability-helper";
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
import TeamSelectionComponent from "dashboard/dataset/team_selection_component";
import { handleGenericError } from "libs/error_handling";
import { validateLayerConfigurationJSON } from "./validation";
import {
  Hideable,
  FormItemWithInfo,
  RetryingErrorBoundary,
  confirmAsync,
  jsonEditStyle,
} from "./helper_components";
import SimpleAdvancedDataForm from "./simple_advanced_data_form";

const FormItem = Form.Item;
const TabPane = Tabs.TabPane;
const Panel = Collapse.Panel;

const toJSON = json => JSON.stringify(json, null, "  ");

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

      this.props.form.setFieldsValue({
        dataSourceJson: toJSON(dataSource),
        dataset: {
          displayName: dataset.displayName || undefined,
          isPublic: dataset.isPublic || false,
          description: dataset.description || undefined,
          allowedTeams: dataset.allowedTeams || [],
        },
      });
      // This call cannot be combined with the previous setFieldsValue,
      // since the layer values wouldn't be initialized correctly.
      this.props.form.setFieldsValue({
        dataSource,
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
      this.props.form.validateFields();
    }
  }

  handleSubmit = (e: SyntheticEvent<>) => {
    e.preventDefault();
    // Ensure that all form fields are in sync, by initiating a sync of the not-active
    // tab
    this.syncDataSourceFields(this.state.activeTabKey === "simple" ? "advanced" : "advanced");
    this.props.form.validateFields(async (err, formValues: FormData) => {
      const { dataset, datasetDefaultConfiguration } = this.state;
      if (err || !dataset) {
        console.log("err", err);
        return;
      }
      const teamIds = formValues.dataset.allowedTeams.map(t => t.id);
      if (teamIds.length === 0) {
        const didConfirm = await confirmAsync({
          title: "Are you sure?",
          content: (
            <p>
              You did not specify any teams, for which this dataset should be visible. This means
              that only administrators and team managers will be able to view this dataset.<br />{" "}
              Please switch to the 'General' tab to review the teams which are allowed to see this
              dataset.
            </p>
          ),
        });
        if (!didConfirm) {
          return;
        }
      }
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

      await updateDatasetTeams(dataset.name, teamIds);

      const verb = this.props.isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${this.props.datasetName}`);
      window.history.back();
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
    const hasNoAllowedTeams =
      this.props.form.getFieldValue("dataset.allowedTeams") == null ||
      this.props.form.getFieldValue("dataset.allowedTeams").length === 0;
    const allowedTeamsComponent = (
      <FormItemWithInfo
        label="Allowed Teams"
        info="Except for administrators and team managers, only members of the teams defined here will be able to view this dataset."
        validateStatus={hasNoAllowedTeams ? "warning" : "success"}
        help={
          hasNoAllowedTeams
            ? "If this field is empty, only administrators and team managers will be able to view this dataset."
            : null
        }
      >
        {getFieldDecorator("dataset.allowedTeams", {})(<TeamSelectionComponent mode="multiple" />)}
      </FormItemWithInfo>
    );
    const content = !this.props.isEditingMode ? (
      allowedTeamsComponent
    ) : (
      <div>
        <Row gutter={48}>
          <Col span={12}>
            <FormItemWithInfo
              label="Display Name"
              info="The display name will be used by webKnossos to name this dataset. If the display name is not provided, the original name will be used."
            >
              {getFieldDecorator("dataset.displayName")(<Input placeholder="Display Name" />)}
            </FormItemWithInfo>
          </Col>
          <Col span={12}>
            <FormItemWithInfo
              label="Description"
              info="The description may contain additional information about your dataset."
            >
              {getFieldDecorator("dataset.description")(
                <Input.TextArea rows="3" placeholder="Description" />,
              )}
            </FormItemWithInfo>
          </Col>
        </Row>
        {allowedTeamsComponent}
        <FormItemWithInfo
          label="Sharing Link"
          info="The sharing link can be used to allow unregistered users viewing this dataset."
        >
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
        </FormItemWithInfo>
        <FormItem>
          {getFieldDecorator("dataset.isPublic", { valuePropName: "checked" })(
            <Checkbox>
              Make dataset publicly accessible{" "}
              <Tooltip title="If checked, the dataset will be listed when unregistered users visit webKnossos.">
                <Icon type="info-circle-o" style={{ color: "gray" }} />
              </Tooltip>
            </Checkbox>,
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
        <Alert
          message="The following settings define the default configuration when viewing or creating an explorational tracing for this dataset. Use them to optimize the initial appearance of your dataset."
          type="info"
          showIcon
        />
        <Row gutter={24}>
          <Col span={6}>
            <FormItemWithInfo
              label="Position"
              info="The default position defined is defined in voxel-coordinates (x, y, z)."
            >
              {getFieldDecorator("defaultConfiguration.position")(<Vector3Input />)}
            </FormItemWithInfo>
          </Col>
          <Col span={6}>
            <FormItemWithInfo
              label="Zoom"
              info="A zoom of &ldquo;1&rdquo; will display the data in its original resolution."
            >
              {getFieldDecorator("defaultConfiguration.zoom")(
                <InputNumber style={{ width: "100%" }} />,
              )}
            </FormItemWithInfo>
          </Col>
          <Col span={6}>
            <FormItemWithInfo
              label="Segmentation Opacity"
              info="The segmentation layer will be overlayed using the specified percentage value (&ldquo;20&rdquo; means &ldquo;20%&rdquo; opacity)."
            >
              {getFieldDecorator("defaultConfiguration.segmentationOpacity")(
                <InputNumber style={{ width: "100%" }} />,
              )}
            </FormItemWithInfo>
          </Col>
          <Col span={6}>
            <FormItem label=" " colon={false}>
              {getFieldDecorator("defaultConfiguration.interpolation", {
                valuePropName: "checked",
              })(
                <Checkbox>
                  Interpolation{" "}
                  <Tooltip
                    title={
                      "If checked, bilinear interpolation will be used when rendering the data."
                    }
                  >
                    <Icon type="info-circle-o" style={{ color: "gray" }} />
                  </Tooltip>
                </Checkbox>,
              )}
            </FormItem>
          </Col>
        </Row>
        <FormItemWithInfo
          label="Layer Configuration"
          info="Use the following JSON to define layer-specific properties, such as color, contrast and brightness."
        >
          {getFieldDecorator("defaultConfigurationLayersJson", {
            rules: [{ validator: validateLayerConfigurationJSON }],
          })(<Input.TextArea rows="10" style={jsonEditStyle} />)}
        </FormItemWithInfo>
      </div>
    );
  }

  syncDataSourceFields(newActiveTab: "simple" | "advanced") {
    const { form } = this.props;
    const parsedConfig = JSON.parse(form.getFieldValue("dataSourceJson"));
    if (newActiveTab === "advanced") {
      // Simple --> advanced: update json

      // parsedConfig has to be used as the base, since `dataSource` will only
      // contain the fields that antd has registered input elements for
      const newDataSource = parsedConfig;
      // _.merge does a deep merge which mutates newDataSource
      _.merge(newDataSource, form.getFieldValue("dataSource"));
      form.setFieldsValue({
        dataSourceJson: toJSON(newDataSource),
      });
    } else {
      // Advanced --> simple: update form values
      form.setFieldsValue({
        dataSource: parsedConfig,
      });
    }
  }

  render() {
    const { form } = this.props;
    const { getFieldDecorator } = form;
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
            {!this.props.isEditingMode ? (
              <p>Please review your dataset&#39;s properties before importing it.</p>
            ) : null}
            {this.getMessageComponents()}

            <Card>
              <Tabs>
                <TabPane tab="Data" key="data" forceRender>
                  <SimpleAdvancedDataForm
                    form={form}
                    activeDataSourceEditTab={this.state.activeDataSourceEditTab}
                    onChange={activeTabKey => {
                      this.syncDataSourceFields(activeTabKey);
                      this.setState({ activeDataSourceEditTab: activeTabKey });
                    }}
                  />
                </TabPane>
                <TabPane tab="General" key="general" forceRender>
                  {this.getGeneralComponents()}
                </TabPane>
                {this.props.isEditingMode ? (
                  <TabPane tab="View Configuration" key="defaultConfig" forceRender>
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
