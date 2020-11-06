// @flow

import { Button, Spin, Icon, Alert, Form, Card, Tabs, Tooltip, Modal, Input } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";
import { connect } from "react-redux";

import type { APIDataSource, APIDataset, APIDatasetId, APIMessage } from "types/api_flow_types";
import type { DatasetConfiguration, OxalisState } from "oxalis/store";
import DatasetCacheProvider, { datasetCache } from "dashboard/dataset/dataset_cache_provider";
import { diffObjects, jsonStringify } from "libs/utils";
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
import { handleGenericError } from "libs/error_handling";
import { trackAction } from "oxalis/model/helpers/analytics";
import Toast from "libs/toast";
import messages from "messages";
import features from "features";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";

import { Hideable, hasFormError, jsonEditStyle } from "./helper_components";
import DefaultConfigComponent from "./default_config_component";
import ImportGeneralComponent from "./import_general_component";
import ImportSharingComponent from "./import_sharing_component";
import ImportDeleteComponent from "./import_delete_component";
import SimpleAdvancedDataForm from "./simple_advanced_data_form";

const { TabPane } = Tabs;
const FormItem = Form.Item;

const notImportedYetStatus = "Not imported yet.";

type OwnProps = {|
  form: Object,
  datasetId: APIDatasetId,
  isEditingMode: boolean,
  onComplete: () => void,
  onCancel: () => void,
|};

type StateProps = {|
  isUserAdmin: boolean,
|};

type Props = {| ...OwnProps, ...StateProps |};

type TabKey = "data" | "general" | "defaultConfig";

type State = {
  dataset: ?APIDataset,
  datasetDefaultConfiguration: ?DatasetConfiguration,
  messages: Array<APIMessage>,
  isLoading: boolean,
  activeDataSourceEditMode: "simple" | "advanced",
  activeTabKey: TabKey,
  previousDataSource: ?APIDataSource,
  differenceBetweenDatasources: ?Object,
};

export type FormData = {
  dataSource: APIDataSource,
  dataSourceJson: string,
  dataset: APIDataset,
  defaultConfiguration: DatasetConfiguration,
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
    differenceBetweenDatasources: null,
    previousDataSource: null,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      const dataset = await getDataset(this.props.datasetId);
      let dataSource;
      let previousDataSource;
      let dataSourceMessages = [];
      if (dataset.isForeign) {
        dataSource = await readDatasetDatasource(dataset);
      } else {
        ({
          dataSource,
          messages: dataSourceMessages,
          previousDataSource,
        } = await getDatasetDatasource(dataset));

        this.setState({ previousDataSource });
        if (previousDataSource != null && dataSource != null) {
          const diff = diffObjects(dataSource, previousDataSource);
          this.setState({ differenceBetweenDatasources: diff });
        }
      }
      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }
      this.props.form.setFieldsValue({
        dataSourceJson: jsonStringify(dataSource),
        dataset: {
          displayName: dataset.displayName || undefined,
          isPublic: dataset.isPublic || false,
          description: dataset.description || undefined,
          allowedTeams: dataset.allowedTeams || [],
          sortingKey: moment(dataset.sortingKey),
        },
      });
      // This call cannot be combined with the previous setFieldsValue,
      // since the layer values wouldn't be initialized correctly.
      this.props.form.setFieldsValue({
        dataSource,
      });

      const datasetDefaultConfiguration = await getDatasetDefaultConfiguration(
        this.props.datasetId,
      );
      enforceValidatedDatasetViewConfiguration(datasetDefaultConfiguration, dataset, true);
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

  getDatasourceDiffAlert() {
    if (
      this.state.previousDataSource == null ||
      this.state.previousDataSource.status === notImportedYetStatus ||
      _.size(this.state.differenceBetweenDatasources) === 0
    ) {
      return null;
    }

    function showJSONModal(title, object) {
      Modal.info({
        title,
        width: 800,
        content: (
          <Input.TextArea rows={20} style={jsonEditStyle}>
            {jsonStringify(object)}
          </Input.TextArea>
        ),
      });
    }

    return (
      <div>
        <Alert
          message={
            <div>
              A datasource-properties.json file was found for this dataset. However, additional
              information about the dataset could be inferred. Please review the following
              properties and click &ldquo;Save&rdquo; to accept the suggestions. The original
              datasource-properties.json file can be seen{" "}
              <a
                href="#"
                onClick={() =>
                  showJSONModal(
                    "Original datasource-properties.json",
                    this.state.previousDataSource,
                  )
                }
              >
                here
              </a>
              . The JSON-encoded difference can be inspected{" "}
              <a
                href="#"
                onClick={() =>
                  showJSONModal(
                    "Difference to new datasource-properties.json",
                    this.state.differenceBetweenDatasources,
                  )
                }
              >
                here
              </a>
              .
            </div>
          }
          type="info"
          showIcon
        />
      </div>
    );
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
      const datasetChangeValues = { ...formValues.dataset };
      if (datasetChangeValues.sortingKey != null) {
        datasetChangeValues.sortingKey = datasetChangeValues.sortingKey.valueOf();
      }
      const teamIds = formValues.dataset.allowedTeams.map(t => t.id);

      await updateDataset(this.props.datasetId, Object.assign({}, dataset, datasetChangeValues));

      if (datasetDefaultConfiguration != null) {
        await updateDatasetDefaultConfiguration(
          this.props.datasetId,
          _.extend({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
            layers: JSON.parse(formValues.defaultConfigurationLayersJson),
          }),
        );
      }
      await updateDatasetTeams(dataset, teamIds);

      const dataSource = JSON.parse(formValues.dataSourceJson);
      if (
        this.state.dataset != null &&
        !this.state.dataset.isForeign &&
        !this.state.dataset.dataStore.isConnector
      ) {
        await updateDatasetDatasource(this.props.datasetId.name, dataset.dataStore.url, dataSource);
        this.setState({ previousDataSource: null, differenceBetweenDatasources: null });
      }

      const verb = this.props.isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${this.props.datasetId.name}`);
      datasetCache.clear();
      trackAction(`Dataset ${verb}`);
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
        // This status is only used, when the dataSource.json is missing.
        status === notImportedYetStatus ? (
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
                Status:
                <br />
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
        dataSourceJson: jsonStringify(newDataSource),
      });
    } else {
      // Copy from advanced to simple: update form values
      form.setFieldsValue({
        dataSource: parsedConfig,
      });
    }
  };

  render() {
    const { form, isUserAdmin } = this.props;
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
              {titleString} Dataset: {this.props.datasetId.name}
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
                      isReadOnlyDataset={
                        this.state.dataset != null &&
                        (this.state.dataset.isForeign || this.state.dataset.dataStore.isConnector)
                      }
                      form={form}
                      activeDataSourceEditMode={this.state.activeDataSourceEditMode}
                      onChange={activeEditMode => {
                        this.syncDataSourceFields(activeEditMode);
                        this.props.form.validateFields();
                        this.setState({ activeDataSourceEditMode: activeEditMode });
                      }}
                      additionalAlert={this.getDatasourceDiffAlert()}
                    />
                  </Hideable>
                </TabPane>

                <TabPane
                  tab={
                    <span>
                      Sharing & Permissions{" "}
                      {formErrors.general ? errorIcon : hasNoAllowedTeamsWarning}
                    </span>
                  }
                  key="sharing"
                  forceRender
                >
                  <Hideable hidden={this.state.activeTabKey !== "sharing"}>
                    <ImportSharingComponent
                      form={form}
                      datasetId={this.props.datasetId}
                      hasNoAllowedTeams={_hasNoAllowedTeams}
                    />
                  </Hideable>
                </TabPane>

                <TabPane tab={<span>Metadata</span>} key="general" forceRender>
                  <Hideable hidden={this.state.activeTabKey !== "general"}>
                    <ImportGeneralComponent form={form} />
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

                {isUserAdmin && features().allowDeleteDatasets ? (
                  <TabPane tab={<span> Delete Dataset </span>} key="deleteDataset" forceRender>
                    <Hideable hidden={this.state.activeTabKey !== "deleteDataset"}>
                      <DatasetCacheProvider>
                        <ImportDeleteComponent datasetId={this.props.datasetId} />
                      </DatasetCacheProvider>
                    </Hideable>
                  </TabPane>
                ) : null}
              </Tabs>
            </Card>
            <FormItem>
              <Button type="primary" htmlType="submit">
                {confirmString}
              </Button>
              &nbsp;
              <Button onClick={this.props.onCancel}>Cancel</Button>
            </FormItem>
          </Spin>
        </Card>
      </Form>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  isUserAdmin: state.activeUser != null && state.activeUser.isAdmin,
});

export default Form.create()(
  connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(DatasetImportView),
);
