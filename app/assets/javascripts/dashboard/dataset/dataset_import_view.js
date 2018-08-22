// @flow

import * as React from "react";
import _ from "lodash";
import { Button, Spin, Icon, Alert, Form, Card, Tabs, Tooltip } from "antd";
import Toast from "libs/toast";
import {
  getDataset,
  updateDataset,
  getDatasetDefaultConfiguration,
  updateDatasetDefaultConfiguration,
  readDatasetDatasource,
  getDatasetDatasource,
  updateDatasetDatasource,
  updateDatasetTeams,
} from "admin/admin_rest_api";
import type { DatasetConfigurationType } from "oxalis/store";
import messages from "messages";
import type {
  APIDatasetType,
  APIMessageType,
  APIDataSourceWithMessagesType,
} from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";
import { datasetCache } from "dashboard/dashboard_view";
import { Hideable, confirmAsync, hasFormError } from "./helper_components";
import SimpleAdvancedDataForm from "./simple_advanced_data_form";
import DefaultConfigComponent from "./default_config_component";
import ImportGeneralComponent from "./import_general_component";

const { TabPane } = Tabs;
const FormItem = Form.Item;

const toJSON = json => JSON.stringify(json, null, "  ");

type Props = {
  form: Object,
  datasetName: string,
  isEditingMode: boolean,
  onComplete: () => void,
  onCancel: () => void,
};

type TabKeyType = "data" | "general" | "defaultConfig";

type State = {
  dataset: ?APIDatasetType,
  datasetDefaultConfiguration: ?DatasetConfigurationType,
  messages: Array<APIMessageType>,
  isLoading: boolean,
  activeDataSourceEditMode: "simple" | "advanced",
  activeTabKey: TabKeyType,
};

export type FormData = {
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
    isLoading: true,
    messages: [],
    activeDataSourceEditMode: "simple",
    activeTabKey: "data",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const dataset = await getDataset(this.props.datasetName);
      let dataSource;
      let dataSourceMessages = [];
      if (dataset.isForeign) {
        dataSource = await readDatasetDatasource(dataset);
      } else {
        ({ dataSource, messages: dataSourceMessages } = await getDatasetDatasource(dataset));
      }
      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }

      this.props.form.setFieldsValue({
        dataSourceJson: toJSON(dataSource),
        dataset: {
          displayName: dataset.displayName || undefined,
          isPublic: dataset.isPublic || false,
          description: dataset.description || undefined,
          allowedTeams: dataset.allowedTeams || [],
        },
      });
      this.setState({ dataset });
      // This call cannot be combined with the previous setFieldsValue,
      // since the layer values wouldn't be initialized correctly.
      this.props.form.setFieldsValue({
        dataSource,
      });

      const defaultConfigPerLayer = {
        brightness: 0,
        contrast: 1,
        color: [255, 255, 255],
      };
      const datasetDefaultConfiguration = (await getDatasetDefaultConfiguration(
        this.props.datasetName,
      )) || {
        layers: _.fromPairs(
          dataSource.dataLayers.map(layer => [layer.name, defaultConfigPerLayer]),
        ),
      };

      this.props.form.setFieldsValue({
        defaultConfiguration: datasetDefaultConfiguration,
        defaultConfigurationLayersJson: JSON.stringify(
          datasetDefaultConfiguration.layers,
          null,
          "  ",
        ),
      });

      this.setState({
        datasetDefaultConfiguration,
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

  getFormValidationSummary = (): Object => {
    const err = this.props.form.getFieldsError();
    const { dataset } = this.state;
    const formErrors = {};
    if (!err || !dataset) {
      return formErrors;
    }
    const hasErr = hasFormError;

    if (hasErr(err.dataSource) || hasErr(err.dataSourceJson)) {
      formErrors.data = true;
    }
    if (hasErr(err.dataset)) {
      formErrors.general = true;
    }
    if (hasErr(err.defaultConfiguration) || hasErr(err.defaultConfigurationLayersJson)) {
      formErrors.defaultConfig = true;
    }
    return formErrors;
  };

  switchToProblematicTab() {
    const validationSummary = this.getFormValidationSummary();
    if (validationSummary[this.state.activeTabKey]) {
      // Active tab is already problematic
      return;
    }
    // Switch to the earliest, problematic tab
    const problematicTab = _.find(
      ["data", "general", "defaultConfig"],
      key => validationSummary[key],
    );

    if (problematicTab) {
      this.setState({ activeTabKey: problematicTab });
    }
  }

  async doesUserWantToChangeAllowedTeams(teamIds: Array<string>): Promise<boolean> {
    if (teamIds.length > 0) {
      return false;
    }
    return !(await confirmAsync({
      title: "Are you sure?",
      content: (
        <p>
          You did not specify any teams, for which this dataset should be visible. This means that
          only administrators and team managers will be able to view this dataset.<br /> Please hit
          &ldquo;Cancel&rdquo; if you would like to review the team permissions in the
          &ldquo;General&rdquo; tab.
        </p>
      ),
    }));
  }

  handleSubmit = (e: SyntheticEvent<>) => {
    e.preventDefault();
    // Ensure that all form fields are in sync
    this.syncDataSourceFields();
    this.props.form.validateFields(async (err, formValues: FormData) => {
      const { dataset, datasetDefaultConfiguration } = this.state;
      if (err || !dataset) {
        this.switchToProblematicTab();
        Toast.warning(messages["dataset.import.invalid_fields"]);
        return;
      }

      const teamIds = formValues.dataset.allowedTeams.map(t => t.id);
      if (await this.doesUserWantToChangeAllowedTeams(teamIds)) {
        return;
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
      if (this.state.dataset != null && !this.state.dataset.isForeign) {
        await updateDatasetDatasource(this.props.datasetName, dataset.dataStore.url, dataSource);
      }

      await updateDatasetTeams(dataset.name, teamIds);

      const verb = this.props.isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${this.props.datasetName}`);
      datasetCache.clear();
      this.props.onComplete();
    });
  };

  getMessageComponents() {
    if (this.state.dataset == null) {
      return null;
    }
    const messageElements = [];
    const { status } = this.state.dataset.dataSource;
    if (status != null) {
      messageElements.push(
        // "Not imported yet." is only used, when the dataSource.json is missing.
        status === "Not imported yet." ? (
          <Alert
            key="datasourceStatus"
            message={<span>{messages["dataset.missing_datasource_json"]}</span>}
            type="info"
            showIcon
          />
        ) : (
          <Alert
            key="datasourceStatus"
            message={
              <span>
                {messages["dataset.invalid_datasource_json"]}
                <br />
                <br />
                Status:<br />
                {this.state.dataset.dataSource.status}
              </span>
            }
            type="error"
            showIcon
          />
        ),
      );
    } else if (!this.props.isEditingMode) {
      // The user just uploaded the dataset, but the import is already complete due to a
      // valid dataSource.json file
      messageElements.push(
        <Alert
          key="datasourceStatus"
          message={<span>{messages["dataset.import_complete"]}</span>}
          type="success"
          showIcon
        />,
      );
    }

    const restMessages = this.state.messages.map((message, i) => (
      // eslint-disable-next-line react/no-array-index-key
      <Alert key={i} message={Object.values(message)[0]} type={Object.keys(message)[0]} showIcon />
    ));
    messageElements.push(...restMessages);

    return <div style={{ marginBottom: 12 }}>{messageElements}</div>;
  }

  hasNoAllowedTeams(): boolean {
    return (
      this.props.form.getFieldValue("dataset.allowedTeams") == null ||
      this.props.form.getFieldValue("dataset.allowedTeams").length === 0
    );
  }

  syncDataSourceFields = (_syncTargetTabKey?: "simple" | "advanced"): void => {
    // If no sync target was provided, update the non-active tab with the values of the active one
    const syncTargetTabKey =
      _syncTargetTabKey ||
      (this.state.activeDataSourceEditMode === "simple" ? "advanced" : "simple");

    const { form } = this.props;
    const parsedConfig = JSON.parse(form.getFieldValue("dataSourceJson"));
    if (syncTargetTabKey === "advanced") {
      // Copy from simple to advanced: update json

      // parsedConfig has to be used as the base, since `dataSource` will only
      // contain the fields that antd has registered input elements for
      const newDataSource = parsedConfig;
      // _.merge does a deep merge which mutates newDataSource
      _.merge(newDataSource, form.getFieldValue("dataSource"));
      form.setFieldsValue({
        dataSourceJson: toJSON(newDataSource),
      });
    } else {
      // Copy from advanced to simple: update form values
      form.setFieldsValue({
        dataSource: parsedConfig,
      });
    }
  };

  render() {
    const { form } = this.props;
    const titleString = this.props.isEditingMode ? "Update" : "Import";
    const confirmString =
      this.props.isEditingMode ||
      (this.state.dataset != null && this.state.dataset.dataSource.status == null)
        ? "Save"
        : "Import";
    const formErrors = this.getFormValidationSummary();

    const errorIcon = (
      <Tooltip title="Some fields in this tab require your attention.">
        <Icon type="exclamation-circle" style={{ color: "#f5222d", marginLeft: 4 }} />
      </Tooltip>
    );
    const _hasNoAllowedTeams = this.hasNoAllowedTeams();
    const hasNoAllowedTeamsWarning = _hasNoAllowedTeams ? (
      <Tooltip title="Please double-check some fields here.">
        <Icon type="exclamation-circle" style={{ color: "#faad14", marginLeft: 4 }} />
      </Tooltip>
    ) : null;

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
            {this.getMessageComponents()}

            <Card>
              <Tabs
                activeKey={this.state.activeTabKey}
                onChange={activeTabKey => this.setState({ activeTabKey })}
              >
                <TabPane
                  tab={<span> Data {formErrors.data ? errorIcon : ""}</span>}
                  key="data"
                  forceRender
                >
                  {
                    // We use the Hideable component here to avoid that the user can "tab"
                    // to hidden form elements.
                  }
                  <Hideable hidden={this.state.activeTabKey !== "data"}>
                    <SimpleAdvancedDataForm
                      key="SimpleAdvancedDataForm"
                      isForeignDataset={this.state.dataset != null && this.state.dataset.isForeign}
                      form={form}
                      activeDataSourceEditMode={this.state.activeDataSourceEditMode}
                      onChange={activeEditMode => {
                        this.syncDataSourceFields(activeEditMode);
                        this.props.form.validateFields();
                        this.setState({ activeDataSourceEditMode: activeEditMode });
                      }}
                    />
                  </Hideable>
                </TabPane>
                <TabPane
                  tab={
                    <span>
                      {" "}
                      General {formErrors.general ? errorIcon : hasNoAllowedTeamsWarning}
                    </span>
                  }
                  key="general"
                  forceRender
                >
                  <Hideable hidden={this.state.activeTabKey !== "general"}>
                    <ImportGeneralComponent
                      form={form}
                      datasetName={this.props.datasetName}
                      hasNoAllowedTeams={_hasNoAllowedTeams}
                    />
                  </Hideable>
                </TabPane>

                <TabPane
                  tab={<span> View Configuration {formErrors.defaultConfig ? errorIcon : ""}</span>}
                  key="defaultConfig"
                  forceRender
                >
                  <Hideable hidden={this.state.activeTabKey !== "defaultConfig"}>
                    <DefaultConfigComponent form={form} />
                  </Hideable>
                </TabPane>
              </Tabs>
            </Card>
            <FormItem>
              <Button type="primary" htmlType="submit">
                {confirmString}
              </Button>&nbsp;
              <Button onClick={this.props.onCancel}>Cancel</Button>
            </FormItem>
          </Spin>
        </Card>
      </Form>
    );
  }
}

export default Form.create()(DatasetImportView);
