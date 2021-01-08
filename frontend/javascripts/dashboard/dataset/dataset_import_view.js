// @flow

import { Button, Spin, Icon, Alert, Form, Card, Tabs, Tooltip, Modal, Input } from "antd";
import * as React from "react";
import _ from "lodash";
import moment from "moment";
import { connect } from "react-redux";

import type {
  APIDataSource,
  APIDataset,
  MutableAPIDataset,
  APIDatasetId,
  APIMessage,
} from "types/api_flow_types";
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
import { isDatasourceJSONValid } from "types/validation";
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

const AppliedSuggestionsEnum = {
  Yes: "Yes",
  No: "No",
  NoAvailableSuggestions: "NoAvailableSuggestions",
};

const IsJSONFormatValidEnum = {
  Yes: "Yes",
  No: "No",
  BrokenJson: "BrokenJson",
};

type DataSourceSettingsStatus = {
  appliedSuggestions: $Keys<typeof AppliedSuggestionsEnum>,
  isJSONFormatValid: $Keys<typeof IsJSONFormatValidEnum>,
};

type State = {
  dataset: ?APIDataset,
  datasetDefaultConfiguration: ?DatasetConfiguration,
  messages: Array<APIMessage>,
  isLoading: boolean,
  activeDataSourceEditMode: "simple" | "advanced",
  activeTabKey: TabKey,
  savedDataSourceOnServer: ?APIDataSource,
  inferredDataSource: ?APIDataSource,
  differenceBetweenDataSources: Object,
  dataSourceSettingsStatus: DataSourceSettingsStatus,
};

export type FormData = {
  dataSource: APIDataSource,
  dataSourceJson: string,
  dataset: APIDataset,
  defaultConfiguration: DatasetConfiguration,
  defaultConfigurationLayersJson: string,
};

function ensureValidScaleOnInferredDataSource(
  savedDataSourceOnServer: ?APIDataSource,
  inferredDataSource: ?APIDataSource,
): ?APIDataSource {
  if (savedDataSourceOnServer == null || inferredDataSource == null) {
    // If one of the data sources is null, return the other.
    return savedDataSourceOnServer || inferredDataSource;
  }
  const inferredDataSourceClone = (_.cloneDeep(inferredDataSource): any);
  if (
    _.isEqual(inferredDataSource.scale, [0, 0, 0]) &&
    !_.isEqual(savedDataSourceOnServer.scale, [0, 0, 0])
  ) {
    inferredDataSourceClone.scale = savedDataSourceOnServer.scale;
  }
  // Trying to use the saved value for largestSegmentId instead of 0.
  if (savedDataSourceOnServer.dataLayers != null && inferredDataSourceClone.dataLayers != null) {
    const segmentationLayerSettings = inferredDataSourceClone.dataLayers.find(
      layer => layer.category === "segmentation",
    );
    const savedSegmentationLayerSettings = savedDataSourceOnServer.dataLayers.find(
      layer => layer.category === "segmentation",
    );
    if (
      segmentationLayerSettings != null &&
      savedSegmentationLayerSettings != null &&
      segmentationLayerSettings.largestSegmentId === 0 &&
      // Flow needs this additional check to understand that segmentationLayerSettings is for the segmentation layer.
      savedSegmentationLayerSettings.category === "segmentation"
    ) {
      segmentationLayerSettings.largestSegmentId = savedSegmentationLayerSettings.largestSegmentId;
    }
  }
  return inferredDataSourceClone;
}

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
    savedDataSourceOnServer: null,
    inferredDataSource: null,
    differenceBetweenDataSources: {},
    dataSourceSettingsStatus: {
      appliedSuggestions: AppliedSuggestionsEnum.NoAvailableSuggestions,
      isJSONFormatValid: IsJSONFormatValidEnum.Yes,
    },
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({ isLoading: true });
      let dataset = await getDataset(this.props.datasetId);
      let dataSource;
      if (dataset.isForeign) {
        dataSource = await readDatasetDatasource(dataset);
        this.setState({ savedDataSourceOnServer: dataSource });
      } else {
        const dataSourceSettingsStatus = {
          appliedSuggestions: AppliedSuggestionsEnum.NoAvailableSuggestions,
          isJSONFormatValid: IsJSONFormatValidEnum.No,
        };
        const {
          dataSource: inferredDataSource,
          messages: dataSourceMessages,
          previousDataSource: savedDataSourceOnServer,
        } = await getDatasetDatasource(dataset);
        const didParsingTheSavedDataSourceJSONSucceed =
          savedDataSourceOnServer != null && savedDataSourceOnServer.status == null;
        if (didParsingTheSavedDataSourceJSONSucceed) {
          dataSource = savedDataSourceOnServer;
          if (isDatasourceJSONValid(savedDataSourceOnServer)) {
            dataSourceSettingsStatus.isJSONFormatValid = IsJSONFormatValidEnum.Yes;
          }

          const diff = diffObjects(inferredDataSource, savedDataSourceOnServer);
          const areObjectsEqual = _.size(diff) === 0;
          if (!areObjectsEqual) {
            dataSourceSettingsStatus.appliedSuggestions = AppliedSuggestionsEnum.No;
            this.setState({ differenceBetweenDataSources: diff });
          }
        } else {
          // If the current datasource json is invalid, the inferred version should be used automatically.
          dataSource = inferredDataSource;
          dataSourceSettingsStatus.isJSONFormatValid = IsJSONFormatValidEnum.BrokenJson;
          dataSourceSettingsStatus.appliedSuggestions = AppliedSuggestionsEnum.Yes;
        }
        const inferredDataSourceWithCorrectedScale = ensureValidScaleOnInferredDataSource(
          savedDataSourceOnServer,
          inferredDataSource,
        );
        this.setState({
          savedDataSourceOnServer,
          inferredDataSource: inferredDataSourceWithCorrectedScale,
          messages: dataSourceMessages,
          dataSourceSettingsStatus,
        });
      }
      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }
      if (dataset.dataSource.status != null && dataset.dataSource.status.includes("Error")) {
        // If the datasource-properties.json could not be parsed due to schema errors,
        // we replace it with the version that is at least parsable.
        const datasetClone = ((_.cloneDeep(dataset): any): MutableAPIDataset);
        // We are keeping the error message to display it to the user.
        datasetClone.dataSource.status = dataset.dataSource.status;
        dataset = (datasetClone: APIDataset);
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
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
      this.props.form.validateFields();
    }
  }

  getDatasourceDiffAlert() {
    // Only show if the option did not apply
    const {
      differenceBetweenDataSources,
      dataSourceSettingsStatus,
      inferredDataSource,
    } = this.state;
    const { appliedSuggestions, isJSONFormatValid } = dataSourceSettingsStatus;

    // No info shown, when:
    // - The parsing succedded
    if (
      (isJSONFormatValid === IsJSONFormatValidEnum.Yes &&
        appliedSuggestions !== AppliedSuggestionsEnum.No) ||
      (isJSONFormatValid === IsJSONFormatValidEnum.No &&
        appliedSuggestions === AppliedSuggestionsEnum.Yes)
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

    let message = null;
    let type = "info";
    const applySuggestedSettings = () => {
      this.props.form.setFieldsValue({
        dataSourceJson: jsonStringify(inferredDataSource),
      });
      this.setState(currentState => {
        const updatedStatus = {
          ...currentState.dataSourceSettingsStatus,
          appliedSuggestions: AppliedSuggestionsEnum.Yes,
        };
        return { dataSourceSettingsStatus: updatedStatus };
      });
    };

    if (isJSONFormatValid === IsJSONFormatValidEnum.BrokenJson) {
      // If the datasource-properties.json on the server is an invalid JSON.
      message = (
        <div>
          The current datasource-properties.json on the server seems to be in an invalid JSON format
          and webKnossos could not parse this file. The settings below are suggested by webKnossos
          and should be adjusted. <br />
          Be aware that webKnossos cannot guess properties like the voxel size or the largest
          segment id. You must set them yourself.
        </div>
      );
      type = "warning";
    } else if (
      isJSONFormatValid === IsJSONFormatValidEnum.No &&
      appliedSuggestions === AppliedSuggestionsEnum.No
    ) {
      // If the datasource-properties.json on the server has invalid or missing properties but is a valid JSON and the server has suggestions.
      message = (
        <div>
          The current datasource-properties.json on the server seems to have invalid or missing
          properties. <br />
          <a
            href="#"
            onClick={() =>
              showJSONModal("Suggested datasource-properties.json", inferredDataSource)
            }
          >
            Here
          </a>{" "}
          are suggested settings from webKnossos. But be aware that properties like the voxel size
          or the largest segment id cannot be detected correctly. <br />
          If you want to apply those settings, click{" "}
          <a href="#" onClick={applySuggestedSettings}>
            here
          </a>
          .
        </div>
      );
    } else if (
      isJSONFormatValid === IsJSONFormatValidEnum.No &&
      appliedSuggestions === AppliedSuggestionsEnum.NoAvailableSuggestions
    ) {
      // If the datasource-properties.json on the server has invalid or missing properties but is a valid JSON but the server has NO suggestions.
      message = (
        <div>
          The current datasource-properties.json on the server seems to have invalid or missing
          properties. Please fix them.
        </div>
      );
    } else if (
      isJSONFormatValid === IsJSONFormatValidEnum.Yes &&
      appliedSuggestions === AppliedSuggestionsEnum.No
    ) {
      // The datasource-properties.json saved on the server is valid and the user did not merge the suggested settings.
      message = (
        <div>
          A datasource-properties.json file was found for this dataset. However, webKnossos found
          additional information about the dataset that could be inferred. The original
          datasource-properties.json settings can be seen below in the advanced version. The
          JSON-encoded difference between the current and the suggested version can be inspected{" "}
          <a
            href="#"
            onClick={() =>
              showJSONModal(
                "Difference to suggested datasource-properties.json",
                differenceBetweenDataSources,
              )
            }
          >
            here
          </a>
          .<br />
          Click{" "}
          <a href="#" onClick={applySuggestedSettings}>
            here
          </a>{" "}
          to set the suggested JSON settings. This will replace the current settings in the form
          with{" "}
          <a
            href="#"
            onClick={() =>
              showJSONModal("Suggested datasource-properties.json", inferredDataSource)
            }
          >
            these settings
          </a>
          .
        </div>
      );
    }

    return message != null ? (
      <div>
        <Alert message={message} type={type} showIcon />
      </div>
    ) : null;
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

  didDatasourceChange(dataSource: Object) {
    return _.size(diffObjects(dataSource, this.state.savedDataSourceOnServer)) > 0;
  }

  isOnlyDatasourceIncorrectAndNotEdited() {
    const validationSummary = this.getFormValidationSummary();
    if (_.size(validationSummary) === 1 && validationSummary.data) {
      try {
        const dataSource = JSON.parse(this.props.form.getFieldValue("dataSourceJson"));
        const didNotEditDatasource = !this.didDatasourceChange(dataSource);
        return didNotEditDatasource;
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  handleSubmit = (e: SyntheticEvent<>) => {
    e.preventDefault();
    // Ensure that all form fields are in sync
    this.syncDataSourceFields();
    this.props.form.validateFields(async (err, formValues: FormData) => {
      const { dataset, datasetDefaultConfiguration } = this.state;
      const isOnlyDatasourceIncorrectAndNotEdited = this.isOnlyDatasourceIncorrectAndNotEdited();
      if ((err && !isOnlyDatasourceIncorrectAndNotEdited) || !dataset) {
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
        dataset != null &&
        !dataset.isForeign &&
        !dataset.dataStore.isConnector &&
        this.didDatasourceChange(dataSource)
      ) {
        await updateDatasetDatasource(this.props.datasetId.name, dataset.dataStore.url, dataSource);
        this.setState({
          savedDataSourceOnServer: dataSource,
          differenceBetweenDataSources: {},
        });
      }

      const verb = this.props.isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${this.props.datasetId.name}.`);
      datasetCache.clear();
      trackAction(`Dataset ${verb}`);
      this.props.onComplete();
    });
  };

  getMessageComponents() {
    if (this.state.dataset == null) {
      return null;
    }
    const { status } = this.state.dataset.dataSource;
    const messageElements = [];
    if (status != null) {
      messageElements.push(
        // This status is only used, when the dataSource.json is missing.
        status === notImportedYetStatus ? (
          <Alert
            key="dataSourceStatus"
            message={<span>{messages["dataset.missing_datasource_json"]}</span>}
            type="info"
            showIcon
          />
        ) : (
          <Alert
            key="dataSourceStatus"
            message={
              <span>
                {messages["dataset.invalid_datasource_json"]}
                <br />
                <br />
                Status:
                <br />
                {status}
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
          key="dataSourceStatus"
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
