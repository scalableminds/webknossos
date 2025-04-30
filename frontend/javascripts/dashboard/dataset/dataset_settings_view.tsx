import { ExclamationCircleOutlined } from "@ant-design/icons";
import { defaultContext } from "@tanstack/react-query";
import {
  getDataset,
  getDatasetDefaultConfiguration,
  readDatasetDatasource,
  sendAnalyticsEvent,
  updateDatasetDatasource,
  updateDatasetDefaultConfiguration,
  updateDatasetPartial,
  updateDatasetTeams,
} from "admin/admin_rest_api";
import { Alert, Button, Card, Form, type FormInstance, Spin, Tabs, Tooltip } from "antd";
import dayjs from "dayjs";
import features from "features";
import type {
  Action as HistoryAction,
  Location as HistoryLocation,
  UnregisterCallback,
} from "history";
import { handleGenericError } from "libs/error_handling";
import Toast from "libs/toast";
import { diffObjects, jsonStringify } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { Unicode } from "oxalis/constants";
import { getReadableURLPart } from "oxalis/model/accessors/dataset_accessor";
import {
  EXPECTED_TRANSFORMATION_LENGTH,
  doAllLayersHaveTheSameRotation,
  getRotationSettingsFromTransformationIn90DegreeSteps,
} from "oxalis/model/accessors/dataset_layer_transformation_accessor";
import type { DatasetConfiguration, OxalisState } from "oxalis/store";
import * as React from "react";
import { connect } from "react-redux";
import type { RouteComponentProps } from "react-router-dom";
import { Link, withRouter } from "react-router-dom";
import type { APIDataSource, APIDataset, APIMessage, MutableAPIDataset } from "types/api_types";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import type { DatasetRotationAndMirroringSettings } from "./dataset_rotation_form_item";
import DatasetSettingsDataTab, { syncDataSourceFields } from "./dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "./dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "./dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "./dataset_settings_sharing_tab";
import DatasetSettingsViewConfigTab from "./dataset_settings_viewconfig_tab";
import { Hideable, hasFormError } from "./helper_components";

const FormItem = Form.Item;
const notImportedYetStatus = "Not imported yet.";
type OwnProps = {
  datasetId: string;
  isEditingMode: boolean;
  onComplete: () => void;
  onCancel: () => void;
};
type StateProps = {
  isUserAdmin: boolean;
};
type Props = OwnProps & StateProps;
type PropsWithFormAndRouter = Props & {
  history: RouteComponentProps["history"];
};
type TabKey = "data" | "general" | "defaultConfig" | "sharing" | "deleteDataset";
type State = {
  hasUnsavedChanges: boolean;
  dataset: APIDataset | null | undefined;
  datasetDefaultConfiguration: DatasetConfiguration | null | undefined;
  messages: Array<APIMessage>;
  isLoading: boolean;
  activeDataSourceEditMode: "simple" | "advanced";
  activeTabKey: TabKey;
  savedDataSourceOnServer: APIDataSource | null | undefined;
};
export type FormData = {
  dataSource: APIDataSource;
  dataSourceJson: string;
  dataset: APIDataset;
  defaultConfiguration: DatasetConfiguration;
  defaultConfigurationLayersJson: string;
  datasetRotation?: DatasetRotationAndMirroringSettings;
};

class DatasetSettingsView extends React.PureComponent<PropsWithFormAndRouter, State> {
  formRef = React.createRef<FormInstance>();
  unblock: UnregisterCallback | null | undefined;
  blockTimeoutId: number | null | undefined;
  static contextType = defaultContext;
  declare context: React.ContextType<typeof defaultContext>;

  state: State = {
    hasUnsavedChanges: false,
    dataset: null,
    datasetDefaultConfiguration: null,
    isLoading: true,
    messages: [],
    activeDataSourceEditMode: "simple",
    activeTabKey: "data",
    savedDataSourceOnServer: null,
  };

  async componentDidMount() {
    await this.fetchData();
    sendAnalyticsEvent("open_dataset_settings", {
      datasetName: this.state.dataset ? this.state.dataset.name : "Not found dataset",
    });

    const beforeUnload = (
      newLocation: HistoryLocation<unknown>,
      action: HistoryAction,
    ): string | false | void => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || newLocation.pathname !== window.location.pathname) {
        const { hasUnsavedChanges } = this.state;

        if (hasUnsavedChanges) {
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

          this.blockTimeoutId = window.setTimeout(() => {
            // restore the event handler in case a user chose to stay on the page
            // @ts-ignore
            window.onbeforeunload = beforeUnload;
          }, 500);
          return messages["dataset.leave_with_unsaved_changes"];
        }
      }
      return;
    };

    this.unblock = this.props.history.block(beforeUnload);
    // @ts-ignore
    window.onbeforeunload = beforeUnload;
  }

  componentWillUnmount() {
    this.unblockHistory();
  }

  unblockHistory() {
    window.onbeforeunload = null;

    if (this.blockTimeoutId != null) {
      clearTimeout(this.blockTimeoutId);
      this.blockTimeoutId = null;
    }

    if (this.unblock != null) {
      this.unblock();
    }
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({
        isLoading: true,
      });
      let dataset = await getDataset(this.props.datasetId);
      const dataSource = await readDatasetDatasource(dataset);

      // Ensure that zarr layers (which aren't inferred by the back-end) are still
      // included in the inferred data source
      this.setState({ savedDataSourceOnServer: dataSource });

      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }

      if (dataset.dataSource.status?.includes("Error")) {
        // If the datasource-properties.json could not be parsed due to schema errors,
        // we replace it with the version that is at least parsable.
        const datasetClone = _.cloneDeep(dataset) as any as MutableAPIDataset;
        // We are keeping the error message to display it to the user.
        datasetClone.dataSource.status = dataset.dataSource.status;
        dataset = datasetClone as APIDataset;
      }

      const form = this.formRef.current;

      if (!form) {
        throw new Error("Form couldn't be initialized.");
      }

      form.setFieldsValue({
        dataSourceJson: jsonStringify(dataSource),
        dataset: {
          name: dataset.name,
          isPublic: dataset.isPublic || false,
          description: dataset.description || undefined,
          allowedTeams: dataset.allowedTeams || [],
          sortingKey: dayjs(dataset.sortingKey),
        },
      });
      // This call cannot be combined with the previous setFieldsValue,
      // since the layer values wouldn't be initialized correctly.
      form.setFieldsValue({
        dataSource,
      });
      // Retrieve the initial dataset rotation settings from the data source config.
      if (doAllLayersHaveTheSameRotation(dataSource.dataLayers)) {
        const firstLayerTransformations = dataSource.dataLayers[0].coordinateTransformations;
        let initialDatasetRotationSettings: DatasetRotationAndMirroringSettings;
        if (
          !firstLayerTransformations ||
          firstLayerTransformations.length !== EXPECTED_TRANSFORMATION_LENGTH
        ) {
          const nulledSetting = { rotationInDegrees: 0, isMirrored: false };
          initialDatasetRotationSettings = { x: nulledSetting, y: nulledSetting, z: nulledSetting };
        } else {
          initialDatasetRotationSettings = {
            // First transformation is a translation to the coordinate system origin.
            x: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[1],
              "x",
            ),
            y: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[2],
              "y",
            ),
            z: getRotationSettingsFromTransformationIn90DegreeSteps(
              firstLayerTransformations[3],
              "z",
            ),
            // Fifth transformation is a translation back to the original position.
          };
        }
        form.setFieldsValue({
          datasetRotation: initialDatasetRotationSettings,
        });
      }
      const datasetDefaultConfiguration = await getDatasetDefaultConfiguration(
        this.props.datasetId,
      );
      enforceValidatedDatasetViewConfiguration(datasetDefaultConfiguration, dataset, true);
      form.setFieldsValue({
        defaultConfiguration: datasetDefaultConfiguration,
        defaultConfigurationLayersJson: JSON.stringify(
          datasetDefaultConfiguration.layers,
          null,
          "  ",
        ),
      });
      this.setState({
        datasetDefaultConfiguration: datasetDefaultConfiguration,
        dataset,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
      const form = this.formRef.current;

      if (form) {
        form.validateFields();
      }
    }
  }

  getFormValidationSummary = (): Record<string, any> => {
    const form = this.formRef.current;

    if (!form) {
      return {};
    }

    const err = form.getFieldsError();
    const { dataset } = this.state;
    const formErrors: Record<string, any> = {};

    if (!err || !dataset) {
      return formErrors;
    }

    const hasErr = hasFormError;

    if (hasErr(err, "dataSource") || hasErr(err, "dataSourceJson")) {
      formErrors.data = true;
    }

    if (hasErr(err, "dataset")) {
      formErrors.general = true;
    }

    if (hasErr(err, "defaultConfiguration") || hasErr(err, "defaultConfigurationLayersJson")) {
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
      (key) => validationSummary[key],
    );

    if (problematicTab) {
      this.setState({
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'string | number | (<U>(callbackfn: (value: s... Remove this comment to see the full error message
        activeTabKey: problematicTab,
      });
    }
  }

  didDatasourceChange(dataSource: Record<string, any>) {
    return _.size(diffObjects(dataSource, this.state.savedDataSourceOnServer || {})) > 0;
  }

  didDatasourceIdChange(dataSource: Record<string, any>) {
    const savedDatasourceId = this.state.savedDataSourceOnServer?.id;
    if (!savedDatasourceId) {
      return false;
    }
    return (
      savedDatasourceId.name !== dataSource.id.name || savedDatasourceId.team !== dataSource.id.team
    );
  }

  isOnlyDatasourceIncorrectAndNotEdited() {
    const validationSummary = this.getFormValidationSummary();
    const form = this.formRef.current;

    if (!form) {
      return false;
    }

    if (_.size(validationSummary) === 1 && validationSummary.data) {
      try {
        const dataSource = JSON.parse(form.getFieldValue("dataSourceJson"));
        const didNotEditDatasource = !this.didDatasourceChange(dataSource);
        return didNotEditDatasource;
      } catch (_e) {
        return false;
      }
    }

    return false;
  }

  handleValidationFailed = ({ values }: { values: FormData }) => {
    const { dataset } = this.state;
    const isOnlyDatasourceIncorrectAndNotEdited = this.isOnlyDatasourceIncorrectAndNotEdited();

    // Check whether the validation error was introduced or existed before
    if (!isOnlyDatasourceIncorrectAndNotEdited || !dataset) {
      this.switchToProblematicTab();
      Toast.warning(messages["dataset.import.invalid_fields"]);
    } else {
      // If the validation error existed before, still attempt to update dataset
      this.submit(values);
    }
  };

  handleSubmit = () => {
    // Ensure that all form fields are in sync
    const form = this.formRef.current;

    if (!form) {
      return;
    }
    syncDataSourceFields(
      form,
      this.state.activeDataSourceEditMode === "simple" ? "advanced" : "simple",
    );

    const afterForceUpdateCallback = () => {
      // Trigger validation manually, because fields may have been updated
      // and defer the validation as it is done asynchronously by antd or so.
      setTimeout(
        () =>
          form
            .validateFields()
            .then((formValues) => this.submit(formValues))
            .catch((errorInfo) => this.handleValidationFailed(errorInfo)),
        0,
      );
    };

    // Need to force update of the SimpleAdvancedDataForm as removing a layer in the advanced tab does not update
    // the form items in the simple tab (only the values are updated). The form items automatically update once
    // the simple tab renders, but this is not the case when the user directly submits the changes.
    this.forceUpdate(afterForceUpdateCallback);
  };

  submit = async (formValues: FormData) => {
    const { dataset, datasetDefaultConfiguration } = this.state;
    const datasetChangeValues = { ...formValues.dataset };

    if (datasetChangeValues.sortingKey != null) {
      datasetChangeValues.sortingKey = datasetChangeValues.sortingKey.valueOf();
    }

    const teamIds = formValues.dataset.allowedTeams.map((t) => t.id);
    await updateDatasetPartial(this.props.datasetId, datasetChangeValues);

    if (datasetDefaultConfiguration != null) {
      await updateDatasetDefaultConfiguration(
        this.props.datasetId,
        _.extend({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
          layers: JSON.parse(formValues.defaultConfigurationLayersJson),
        }),
      );
    }

    await updateDatasetTeams(this.props.datasetId, teamIds);
    const dataSource = JSON.parse(formValues.dataSourceJson);

    if (dataset != null && this.didDatasourceChange(dataSource)) {
      if (this.didDatasourceIdChange(dataSource)) {
        Toast.warning(messages["dataset.settings.updated_datasource_id_warning"]);
      }
      await updateDatasetDatasource(dataset.directoryName, dataset.dataStore.url, dataSource);
      this.setState({
        savedDataSourceOnServer: dataSource,
      });
    }

    const verb = this.props.isEditingMode ? "updated" : "imported";
    Toast.success(`Successfully ${verb} ${dataset?.name || this.props.datasetId}.`);
    this.setState({
      hasUnsavedChanges: false,
    });

    if (dataset) {
      // Update new cache
      const queryClient = this.context;
      if (queryClient) {
        queryClient.invalidateQueries({
          queryKey: ["datasetsByFolder", dataset.folderId],
        });
        queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
      }
    }

    this.props.onComplete();
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
            type="error"
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

    const restMessages = this.state.messages.map((message) => (
      <Alert
        key={Object.values(message)[0]}
        message={Object.values(message)[0]}
        /* @ts-ignore */
        type={Object.keys(message)[0]}
        showIcon
      />
    ));
    messageElements.push(...restMessages);
    return (
      <div
        style={{
          marginBottom: 12,
        }}
      >
        {messageElements}
      </div>
    );
  }

  onValuesChange = (_changedValues: FormData, _allValues: FormData) => {
    this.setState({
      hasUnsavedChanges: true,
    });
  };

  onCancel = () => {
    this.unblockHistory();
    this.props.onCancel();
  };

  render() {
    const form = this.formRef.current;
    const { dataset } = this.state;

    const maybeStoredDatasetName = dataset?.name || this.props.datasetId;
    const maybeDataSourceId = dataset
      ? {
          owningOrganization: dataset.owningOrganization,
          directoryName: dataset.directoryName,
        }
      : null;

    const { isUserAdmin } = this.props;
    const titleString = this.props.isEditingMode ? "Settings for" : "Import";
    const datasetLinkOrName = this.props.isEditingMode ? (
      <Link
        to={`/datasets/${this.state.dataset ? getReadableURLPart(this.state.dataset) : this.props.datasetId}/view`}
      >
        {maybeStoredDatasetName}
      </Link>
    ) : (
      maybeStoredDatasetName
    );
    const confirmString =
      this.props.isEditingMode ||
      (this.state.dataset != null && this.state.dataset.dataSource.status == null)
        ? "Save"
        : "Import";
    const formErrors = this.getFormValidationSummary();
    const errorIcon = (
      <Tooltip title="Some fields in this tab require your attention.">
        <ExclamationCircleOutlined
          style={{
            marginLeft: 4,
            color: "var(--ant-color-error)",
          }}
        />
      </Tooltip>
    );

    const tabs = [
      {
        label: <span> Data {formErrors.data ? errorIcon : ""}</span>,
        key: "data",
        forceRender: true,
        children: (
          <Hideable hidden={this.state.activeTabKey !== "data"}>
            {
              // We use the Hideable component here to avoid that the user can "tab"
              // to hidden form elements.
            }
            {form && (
              <DatasetSettingsDataTab
                key="SimpleAdvancedDataForm"
                dataset={this.state.dataset}
                form={form}
                activeDataSourceEditMode={this.state.activeDataSourceEditMode}
                onChange={(activeEditMode) => {
                  const currentForm = this.formRef.current;

                  if (!currentForm) {
                    return;
                  }

                  syncDataSourceFields(currentForm, activeEditMode);
                  currentForm.validateFields();
                  this.setState({
                    activeDataSourceEditMode: activeEditMode,
                  });
                }}
              />
            )}
          </Hideable>
        ),
      },

      {
        label: <span>Sharing & Permissions {formErrors.general ? errorIcon : null}</span>,
        key: "sharing",
        forceRender: true,
        children: (
          <Hideable hidden={this.state.activeTabKey !== "sharing"}>
            <DatasetSettingsSharingTab
              form={form}
              datasetId={this.props.datasetId}
              dataset={this.state.dataset}
            />
          </Hideable>
        ),
      },

      {
        label: <span>Metadata</span>,
        key: "general",
        forceRender: true,
        children: (
          <Hideable hidden={this.state.activeTabKey !== "general"}>
            <DatasetSettingsMetadataTab />
          </Hideable>
        ),
      },

      {
        label: <span> View Configuration {formErrors.defaultConfig ? errorIcon : ""}</span>,
        key: "defaultConfig",
        forceRender: true,
        children: (
          <Hideable hidden={this.state.activeTabKey !== "defaultConfig"}>
            {
              maybeDataSourceId ? (
                <DatasetSettingsViewConfigTab
                  dataSourceId={maybeDataSourceId}
                  dataStoreURL={this.state.dataset?.dataStore.url}
                />
              ) : null /* null case should never be rendered as tabs are only rendered when the dataset is loaded. */
            }
          </Hideable>
        ),
      },
    ];

    if (isUserAdmin && features().allowDeleteDatasets)
      tabs.push({
        label: <span> Delete Dataset </span>,
        key: "deleteDataset",
        forceRender: true,
        children: (
          <Hideable hidden={this.state.activeTabKey !== "deleteDataset"}>
            <DatasetSettingsDeleteTab datasetId={this.props.datasetId} />
          </Hideable>
        ),
      });

    return (
      <Form
        ref={this.formRef}
        className="row container dataset-import"
        onFinish={this.handleSubmit}
        onFinishFailed={this.handleSubmit}
        onValuesChange={this.onValuesChange}
        layout="vertical"
      >
        <Card
          bordered={false}
          title={
            <h3>
              {titleString} Dataset {datasetLinkOrName}
            </h3>
          }
        >
          <Spin size="large" spinning={this.state.isLoading}>
            {this.getMessageComponents()}

            <Card>
              <Tabs
                activeKey={this.state.activeTabKey}
                onChange={(activeTabKey) =>
                  this.setState({
                    // @ts-expect-error ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'TabKey'.
                    activeTabKey,
                  })
                }
                items={tabs}
              />
            </Card>
            <FormItem
              style={{
                marginTop: 8,
              }}
            >
              <Button type="primary" htmlType="submit">
                {confirmString}
              </Button>
              {Unicode.NonBreakingSpace}
              <Button onClick={this.onCancel}>Cancel</Button>
            </FormItem>
          </Spin>
        </Card>
      </Form>
    );
  }
}

const mapStateToProps = (state: OxalisState): StateProps => ({
  isUserAdmin: state.activeUser?.isAdmin || false,
});

const connector = connect(mapStateToProps);
export default connector(withRouter<RouteComponentProps & OwnProps, any>(DatasetSettingsView));
