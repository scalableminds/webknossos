import {
  Button,
  Spin,
  Alert,
  Form,
  Card,
  Tabs,
  Tooltip,
  Modal,
  Input,
  FormInstance,
  AlertProps,
} from "antd";
import { ExclamationCircleOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import dayjs from "dayjs";
import { connect } from "react-redux";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter, Link } from "react-router-dom";
import { UnregisterCallback, Location as HistoryLocation, Action as HistoryAction } from "history";
import type {
  APIDataSource,
  APIDataset,
  MutableAPIDataset,
  MutableAPIDataSource,
  APIDatasetId,
  APIMessage,
  APIUnimportedDatasource,
} from "types/api_flow_types";
import { Unicode, Vector3 } from "oxalis/constants";
import type { DatasetConfiguration, OxalisState } from "oxalis/store";
import LinkButton from "components/link_button";
import { diffObjects, jsonStringify } from "libs/utils";
import {
  getDataset,
  getDatasetDefaultConfiguration,
  updateDatasetDefaultConfiguration,
  getDatasetDatasource,
  updateDatasetDatasource,
  updateDatasetTeams,
  sendAnalyticsEvent,
  updateDatasetPartial,
} from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import { trackAction } from "oxalis/model/helpers/analytics";
import Toast from "libs/toast";
import messages from "messages";
import features from "features";
import { isDatasourceJSONValid } from "types/validation";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import { Hideable, hasFormError, jsonEditStyle } from "./helper_components";
import DatasetSettingsViewConfigTab from "./dataset_settings_viewconfig_tab";
import DatasetSettingsMetadataTab from "./dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "./dataset_settings_sharing_tab";
import DatasetSettingsDeleteTab from "./dataset_settings_delete_tab";
import DatasetSettingsDataTab, { syncDataSourceFields } from "./dataset_settings_data_tab";
import { defaultContext } from "@tanstack/react-query";

const FormItem = Form.Item;
const notImportedYetStatus = "Not imported yet.";
type OwnProps = {
  datasetId: APIDatasetId;
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
enum AppliedSuggestionsEnum {
  Yes = "Yes",
  No = "No",
  NoAvailableSuggestions = "NoAvailableSuggestions",
}
enum IsJSONFormatValidEnum {
  Yes = "Yes",
  No = "No",
  BrokenJson = "BrokenJson",
}
type DataSourceSettingsStatus = {
  appliedSuggestions: keyof typeof AppliedSuggestionsEnum;
  isJSONFormatValid: keyof typeof IsJSONFormatValidEnum;
};
type State = {
  hasUnsavedChanges: boolean;
  dataset: APIDataset | null | undefined;
  datasetDefaultConfiguration: DatasetConfiguration | null | undefined;
  messages: Array<APIMessage>;
  isLoading: boolean;
  activeDataSourceEditMode: "simple" | "advanced";
  activeTabKey: TabKey;
  savedDataSourceOnServer: APIDataSource | APIUnimportedDatasource | null | undefined;
  inferredDataSource: APIDataSource | null | undefined;
  differenceBetweenDataSources: Record<string, any>;
  dataSourceSettingsStatus: DataSourceSettingsStatus;
};
export type FormData = {
  dataSource: APIDataSource;
  dataSourceJson: string;
  dataset: APIDataset;
  defaultConfiguration: DatasetConfiguration;
  defaultConfigurationLayersJson: string;
};

function ensureValidScaleOnInferredDataSource(
  savedDataSourceOnServer: APIDataSource | APIUnimportedDatasource | null | undefined,
  inferredDataSource: APIDataSource | null | undefined,
): APIDataSource | null | undefined {
  if (savedDataSourceOnServer == null || inferredDataSource == null) {
    // If one of the data sources is null, return the other.
    const potentialSource = savedDataSourceOnServer || inferredDataSource;
    if (potentialSource && "dataLayers" in potentialSource) {
      return potentialSource as APIDataSource;
    } else {
      return null;
    }
  }

  const inferredDataSourceClone = _.cloneDeep(inferredDataSource) as any as MutableAPIDataSource;

  const savedScale =
    "dataLayers" in savedDataSourceOnServer
      ? savedDataSourceOnServer.scale
      : ([0, 0, 0] as Vector3);
  if (_.isEqual(inferredDataSource.scale, [0, 0, 0]) && !_.isEqual(savedScale, [0, 0, 0])) {
    inferredDataSourceClone.scale = savedScale;
  }

  // Trying to use the saved value for largestSegmentId instead of 0.
  if (
    "dataLayers" in savedDataSourceOnServer &&
    savedDataSourceOnServer.dataLayers != null &&
    inferredDataSourceClone.dataLayers != null
  ) {
    const segmentationLayerSettings = inferredDataSourceClone.dataLayers.find(
      (layer) => layer.category === "segmentation",
    );
    const savedSegmentationLayerSettings = savedDataSourceOnServer.dataLayers.find(
      (layer) => layer.category === "segmentation",
    );

    if (
      segmentationLayerSettings != null &&
      savedSegmentationLayerSettings != null &&
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'largestSegmentId' does not exist on type... Remove this comment to see the full error message
      segmentationLayerSettings.largestSegmentId === 0 && // Flow needs this additional check to understand that segmentationLayerSettings is for the segmentation layer.
      savedSegmentationLayerSettings.category === "segmentation" &&
      segmentationLayerSettings.category === "segmentation"
    ) {
      // @ts-expect-error ts-migrate(2540) FIXME: Cannot assign to 'largestSegmentId' because it is ... Remove this comment to see the full error message
      segmentationLayerSettings.largestSegmentId = savedSegmentationLayerSettings.largestSegmentId;
    }
  }

  return inferredDataSourceClone;
}

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
    inferredDataSource: null,
    differenceBetweenDataSources: {},
    dataSourceSettingsStatus: {
      appliedSuggestions: AppliedSuggestionsEnum.NoAvailableSuggestions,
      isJSONFormatValid: IsJSONFormatValidEnum.Yes,
    },
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
      // eslint-disable-next-line consistent-return, no-useless-return
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
      let dataSource;

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

      // Ensure that zarr layers (which aren't inferred by the back-end) are still
      // included in the inferred data source
      if (
        savedDataSourceOnServer &&
        "dataLayers" in savedDataSourceOnServer &&
        inferredDataSource != null
      ) {
        const layerDict = _.keyBy(inferredDataSource.dataLayers, "name");
        for (const layer of savedDataSourceOnServer.dataLayers) {
          if (layer.dataFormat === "zarr" && layerDict[layer.name] == null) {
            inferredDataSource.dataLayers.push(layer);
          }
        }
      }

      if (didParsingTheSavedDataSourceJSONSucceed) {
        dataSource = savedDataSourceOnServer;

        if (isDatasourceJSONValid(savedDataSourceOnServer)) {
          dataSourceSettingsStatus.isJSONFormatValid = IsJSONFormatValidEnum.Yes;
        }

        const diff = diffObjects(inferredDataSource || {}, savedDataSourceOnServer);
        const areObjectsEqual = _.size(diff) === 0;

        if (!areObjectsEqual) {
          dataSourceSettingsStatus.appliedSuggestions = AppliedSuggestionsEnum.No;
          this.setState({
            differenceBetweenDataSources: diff,
          });
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
          displayName: dataset.displayName || undefined,
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

  getDatasourceDiffAlert() {
    // Only show if the option did not apply
    const { differenceBetweenDataSources, dataSourceSettingsStatus, inferredDataSource } =
      this.state;
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

    function showJSONModal(title: string, object: any) {
      Modal.info({
        title,
        width: 800,
        content: <Input.TextArea rows={20} style={jsonEditStyle} value={jsonStringify(object)} />,
      });
    }

    let message = null;
    let type: AlertProps["type"] = "info";

    const applySuggestedSettings = () => {
      const form = this.formRef.current;

      if (!form) {
        return;
      }

      form.setFieldsValue({
        // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Readonly<MutableAPIDataSource> |... Remove this comment to see the full error message
        dataSourceJson: jsonStringify(inferredDataSource),
        dataSource: inferredDataSource,
      });
      this.setState(
        (currentState) => {
          const updatedStatus = {
            ...currentState.dataSourceSettingsStatus,
            appliedSuggestions: AppliedSuggestionsEnum.Yes,
          };
          return {
            dataSourceSettingsStatus: updatedStatus,
            hasUnsavedChanges: true,
          };
        }, // Enforce validation as antd does not do this automatically.
        () => {
          const currentForm = this.formRef.current;

          if (currentForm) {
            currentForm.validateFields();
          }
        },
      );
    };

    if (isJSONFormatValid === IsJSONFormatValidEnum.BrokenJson) {
      // If the datasource-properties.json on the server is an invalid JSON.
      message = (
        <div>
          The current datasource-properties.json on the server seems to be in an invalid JSON format
          (or is missing completely). The settings below are suggested by WEBKNOSSOS and should be
          adjusted. <br />
          Be aware that WEBKNOSSOS cannot guess properties like the voxel size or the largest
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
          <LinkButton
            onClick={() =>
              showJSONModal("Suggested datasource-properties.json", inferredDataSource)
            }
          >
            Here
          </LinkButton>{" "}
          are suggested settings from WEBKNOSSOS. But be aware that properties like the voxel size
          or the largest segment id cannot be detected correctly. <br />
          If you want to apply those settings, click{" "}
          <LinkButton onClick={applySuggestedSettings}>here</LinkButton>.
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
          WEBKNOSSOS detected additional information not yet present in the dataset’s{" "}
          <em>datasource-properties.json</em> file:
          <div
            style={{
              marginTop: 8,
            }}
          >
            <Button
              size="small"
              style={{
                marginRight: 6,
              }}
              type="primary"
              onClick={applySuggestedSettings}
            >
              Apply Suggestions
            </Button>
            <Button
              size="small"
              style={{
                marginRight: 6,
              }}
              onClick={() =>
                showJSONModal("Suggested datasource-properties.json", inferredDataSource)
              }
            >
              Preview Suggestions
            </Button>
            <Button
              size="small"
              style={{
                marginRight: 6,
              }}
              onClick={() =>
                showJSONModal(
                  "Difference (JSON-encoded) to suggested datasource-properties.json",
                  differenceBetweenDataSources,
                )
              }
            >
              Inspect Difference
            </Button>
          </div>
        </div>
      );
    }

    return message != null ? (
      <div>
        <Alert message={message} type={type} showIcon />
      </div>
    ) : null;
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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'Readonly<MutableAPIDataSource> |... Remove this comment to see the full error message
    return _.size(diffObjects(dataSource, this.state.savedDataSourceOnServer)) > 0;
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

    const afterForceUpdateCallback = () =>
      // Trigger validation manually, because fields may have been updated
      form
        .validateFields()
        .then((formValues) => this.submit(formValues))
        .catch((errorInfo) => this.handleValidationFailed(errorInfo));

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
      await updateDatasetDatasource(this.props.datasetId.name, dataset.dataStore.url, dataSource);
      this.setState({
        savedDataSourceOnServer: dataSource,
        differenceBetweenDataSources: {},
      });
    }

    const verb = this.props.isEditingMode ? "updated" : "imported";
    Toast.success(`Successfully ${verb} ${this.props.datasetId.name}.`);
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

    trackAction(`Dataset ${verb}`);
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

    const { isUserAdmin } = this.props;
    const titleString = this.props.isEditingMode ? "Settings for" : "Import";
    const datasetLinkOrName = this.props.isEditingMode ? (
      <Link
        to={`/datasets/${this.props.datasetId.owningOrganization}/${this.props.datasetId.name}`}
      >
        {this.props.datasetId.name}
      </Link>
    ) : (
      this.props.datasetId.name
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
                allowRenamingDataset={false}
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
                additionalAlert={this.getDatasourceDiffAlert()}
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
            <DatasetSettingsViewConfigTab />
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
