import { ExclamationCircleOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  getDataset,
  getDatasetDefaultConfiguration,
  readDatasetDatasource,
  sendAnalyticsEvent,
  updateDatasetDatasource,
  updateDatasetDefaultConfiguration,
  updateDatasetPartial,
  updateDatasetTeams,
} from "admin/rest_api";
import { Alert, Button, Card, Form, Spin, Tabs, Tooltip } from "antd";
import dayjs from "dayjs";
import features from "features";
import type {
  Action as HistoryAction,
  Location as HistoryLocation,
  UnregisterCallback,
} from "history";
import { handleGenericError } from "libs/error_handling";
import { useWkSelector } from "libs/react_hooks";
import Toast from "libs/toast";
import { jsonStringify } from "libs/utils";
import _ from "lodash";
import messages from "messages";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useHistory } from "react-router-dom";
import type { APIDataSource, APIDataset, MutableAPIDataset } from "types/api_types";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import { Unicode } from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import {
  EXPECTED_TRANSFORMATION_LENGTH,
  doAllLayersHaveTheSameRotation,
  getRotationSettingsFromTransformationIn90DegreeSteps,
} from "viewer/model/accessors/dataset_layer_transformation_accessor";
import type { DatasetConfiguration } from "viewer/store";
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

type TabKey = "data" | "general" | "defaultConfig" | "sharing" | "deleteDataset";

export type FormData = {
  dataSource: APIDataSource;
  dataSourceJson: string;
  dataset: APIDataset;
  defaultConfiguration: DatasetConfiguration;
  defaultConfigurationLayersJson: string;
  datasetRotation?: DatasetRotationAndMirroringSettings;
};

const DatasetSettingsView: React.FC<Props> = ({
  datasetId,
  isEditingMode,
  onComplete,
  onCancel,
}) => {
  const [form] = Form.useForm();
  const history = useHistory();
  const queryClient = useQueryClient();
  const isUserAdmin = useWkSelector((state) => state.activeUser?.isAdmin || false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [dataset, setDataset] = useState<APIDataset | null | undefined>(null);
  const [datasetDefaultConfiguration, setDatasetDefaultConfiguration] = useState<
    DatasetConfiguration | null | undefined
  >(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeDataSourceEditMode, setActiveDataSourceEditMode] = useState<"simple" | "advanced">(
    "simple",
  );
  const [activeTabKey, setActiveTabKey] = useState<TabKey>("data");
  const [savedDataSourceOnServer, setSavedDataSourceOnServer] = useState<
    APIDataSource | null | undefined
  >(null);

  const unblockRef = useRef<UnregisterCallback | null>(null);
  const blockTimeoutIdRef = useRef<number | null>(null);

  const unblockHistory = useCallback(() => {
    window.onbeforeunload = null;

    if (blockTimeoutIdRef.current != null) {
      clearTimeout(blockTimeoutIdRef.current);
      blockTimeoutIdRef.current = null;
    }

    if (unblockRef.current != null) {
      unblockRef.current();
      unblockRef.current = null;
    }
  }, []);

  const fetchData = useCallback(async (): Promise<void> => {
    try {
      setIsLoading(true);
      let fetchedDataset = await getDataset(datasetId);
      const dataSource = await readDatasetDatasource(fetchedDataset);

      // Ensure that zarr layers (which aren't inferred by the back-end) are still
      // included in the inferred data source
      setSavedDataSourceOnServer(dataSource);

      if (dataSource == null) {
        throw new Error("No datasource received from server.");
      }

      if (fetchedDataset.dataSource.status?.includes("Error")) {
        // If the datasource-properties.json could not be parsed due to schema errors,
        // we replace it with the version that is at least parsable.
        const datasetClone = _.cloneDeep(fetchedDataset) as any as MutableAPIDataset;
        // We are keeping the error message to display it to the user.
        datasetClone.dataSource.status = fetchedDataset.dataSource.status;
        fetchedDataset = datasetClone as APIDataset;
      }

      form.setFieldsValue({
        dataSourceJson: jsonStringify(dataSource),
        dataset: {
          name: fetchedDataset.name,
          isPublic: fetchedDataset.isPublic || false,
          description: fetchedDataset.description || undefined,
          allowedTeams: fetchedDataset.allowedTeams || [],
          sortingKey: dayjs(fetchedDataset.sortingKey),
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

      const fetchedDatasetDefaultConfiguration = await getDatasetDefaultConfiguration(datasetId);
      enforceValidatedDatasetViewConfiguration(
        fetchedDatasetDefaultConfiguration,
        fetchedDataset,
        true,
      );
      form.setFieldsValue({
        defaultConfiguration: fetchedDatasetDefaultConfiguration,
        defaultConfigurationLayersJson: JSON.stringify(
          fetchedDatasetDefaultConfiguration.layers,
          null,
          "  ",
        ),
      });

      setDatasetDefaultConfiguration(fetchedDatasetDefaultConfiguration);
      setDataset(fetchedDataset);
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      setIsLoading(false);
      form.validateFields();
    }
  }, [datasetId, form]);

  const getFormValidationSummary = useCallback((): Record<string, any> => {
    const err = form.getFieldsError();
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
  }, [form, dataset]);

  const switchToProblematicTab = useCallback(() => {
    const validationSummary = getFormValidationSummary();

    if (validationSummary[activeTabKey]) {
      // Active tab is already problematic
      return;
    }

    // Switch to the earliest, problematic tab
    const problematicTab = _.find(
      ["data", "general", "defaultConfig"],
      (key) => validationSummary[key],
    );

    if (problematicTab) {
      setActiveTabKey(problematicTab as TabKey);
    }
  }, [getFormValidationSummary, activeTabKey]);

  const didDatasourceChange = useCallback(
    (dataSource: Record<string, any>) => {
      return !_.isEqual(dataSource, savedDataSourceOnServer || {});
    },
    [savedDataSourceOnServer],
  );

  const didDatasourceIdChange = useCallback(
    (dataSource: Record<string, any>) => {
      const savedDatasourceId = savedDataSourceOnServer?.id;
      if (!savedDatasourceId) {
        return false;
      }
      return (
        savedDatasourceId.name !== dataSource.id.name ||
        savedDatasourceId.team !== dataSource.id.team
      );
    },
    [savedDataSourceOnServer],
  );

  const isOnlyDatasourceIncorrectAndNotEdited = useCallback(() => {
    const validationSummary = getFormValidationSummary();

    if (_.size(validationSummary) === 1 && validationSummary.data) {
      try {
        const dataSource = JSON.parse(form.getFieldValue("dataSourceJson"));
        const didNotEditDatasource = !didDatasourceChange(dataSource);
        return didNotEditDatasource;
      } catch (_e) {
        return false;
      }
    }

    return false;
  }, [getFormValidationSummary, form, didDatasourceChange]);

  const submit = useCallback(
    async (formValues: FormData) => {
      const datasetChangeValues = { ...formValues.dataset };

      if (datasetChangeValues.sortingKey != null) {
        datasetChangeValues.sortingKey = datasetChangeValues.sortingKey.valueOf();
      }

      const teamIds = formValues.dataset.allowedTeams.map((t) => t.id);
      await updateDatasetPartial(datasetId, datasetChangeValues);

      if (datasetDefaultConfiguration != null) {
        await updateDatasetDefaultConfiguration(
          datasetId,
          _.extend({}, datasetDefaultConfiguration, formValues.defaultConfiguration, {
            layers: JSON.parse(formValues.defaultConfigurationLayersJson),
          }),
        );
      }

      await updateDatasetTeams(datasetId, teamIds);
      const dataSource = JSON.parse(formValues.dataSourceJson);

      if (dataset != null && didDatasourceChange(dataSource)) {
        if (didDatasourceIdChange(dataSource)) {
          Toast.warning(messages["dataset.settings.updated_datasource_id_warning"]);
        }
        await updateDatasetDatasource(dataset.directoryName, dataset.dataStore.url, dataSource);
        setSavedDataSourceOnServer(dataSource);
      }

      const verb = isEditingMode ? "updated" : "imported";
      Toast.success(`Successfully ${verb} ${dataset?.name || datasetId}.`);
      setHasUnsavedChanges(false);

      if (dataset && queryClient) {
        // Update new cache
        queryClient.invalidateQueries({
          queryKey: ["datasetsByFolder", dataset.folderId],
        });
        queryClient.invalidateQueries({ queryKey: ["dataset", "search"] });
      }

      onComplete();
    },
    [
      datasetId,
      datasetDefaultConfiguration,
      dataset,
      didDatasourceChange,
      didDatasourceIdChange,
      isEditingMode,
      queryClient,
      onComplete,
    ],
  );

  const handleValidationFailed = useCallback(
    ({ values }: { values: FormData }) => {
      const isOnlyDatasourceIncorrectAndNotEditedResult = isOnlyDatasourceIncorrectAndNotEdited();

      // Check whether the validation error was introduced or existed before
      if (!isOnlyDatasourceIncorrectAndNotEditedResult || !dataset) {
        switchToProblematicTab();
        Toast.warning(messages["dataset.import.invalid_fields"]);
      } else {
        // If the validation error existed before, still attempt to update dataset
        submit(values);
      }
    },
    [isOnlyDatasourceIncorrectAndNotEdited, dataset, switchToProblematicTab, submit],
  );

  const handleSubmit = useCallback(() => {
    // Ensure that all form fields are in sync
    syncDataSourceFields(form, activeDataSourceEditMode === "simple" ? "advanced" : "simple");

    const afterForceUpdateCallback = () => {
      // Trigger validation manually, because fields may have been updated
      // and defer the validation as it is done asynchronously by antd or so.
      setTimeout(
        () =>
          form
            .validateFields()
            .then((formValues) => submit(formValues))
            .catch((errorInfo) => handleValidationFailed(errorInfo)),
        0,
      );
    };

    // Need to force update of the SimpleAdvancedDataForm as removing a layer in the advanced tab does not update
    // the form items in the simple tab (only the values are updated). The form items automatically update once
    // the simple tab renders, but this is not the case when the user directly submits the changes.
    // In functional components, we can trigger a re-render by updating state
    setActiveDataSourceEditMode((prev) => prev); // Force re-render
    setTimeout(afterForceUpdateCallback, 0);
  }, [form, activeDataSourceEditMode, submit, handleValidationFailed]);

  const onValuesChange = useCallback((_changedValues: FormData, _allValues: FormData) => {
    setHasUnsavedChanges(true);
  }, []);

  const handleCancel = useCallback(() => {
    unblockHistory();
    onCancel();
  }, [unblockHistory, onCancel]);

  const handleDataSourceEditModeChange = useCallback(
    (activeEditMode: "simple" | "advanced") => {
      syncDataSourceFields(form, activeEditMode);
      form.validateFields();
      setActiveDataSourceEditMode(activeEditMode);
    },
    [form],
  );

  // Setup beforeunload handling
  useEffect(() => {
    const beforeUnload = (
      newLocation: HistoryLocation<unknown>,
      action: HistoryAction,
    ): string | false | void => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || newLocation.pathname !== window.location.pathname) {
        if (hasUnsavedChanges) {
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

          blockTimeoutIdRef.current = window.setTimeout(() => {
            // restore the event handler in case a user chose to stay on the page
            // @ts-ignore
            window.onbeforeunload = beforeUnload;
          }, 500);
          return messages["dataset.leave_with_unsaved_changes"];
        }
      }
      return;
    };

    unblockRef.current = history.block(beforeUnload);
    // @ts-ignore
    window.onbeforeunload = beforeUnload;

    return () => {
      unblockHistory();
    };
  }, [history, hasUnsavedChanges, unblockHistory]);

  // Initial data fetch and analytics
  // biome-ignore lint/correctness/useExhaustiveDependencies: dataset dependency removed to avoid infinite loop
  useEffect(() => {
    fetchData();
    sendAnalyticsEvent("open_dataset_settings", {
      datasetName: dataset ? dataset.name : "Not found dataset",
    });
  }, [fetchData]);

  const getMessageComponents = useCallback(() => {
    if (dataset == null) {
      return null;
    }

    const { status } = dataset.dataSource;
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
    } else if (!isEditingMode) {
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

    return (
      <div
        style={{
          marginBottom: 12,
        }}
      >
        {messageElements}
      </div>
    );
  }, [dataset, isEditingMode]);

  const maybeStoredDatasetName = dataset?.name || datasetId;
  const maybeDataSourceId = dataset
    ? {
        owningOrganization: dataset.owningOrganization,
        directoryName: dataset.directoryName,
      }
    : null;

  const titleString = isEditingMode ? "Settings for" : "Import";
  const datasetLinkOrName = isEditingMode ? (
    <Link to={`/datasets/${dataset ? getReadableURLPart(dataset) : datasetId}/view`}>
      {maybeStoredDatasetName}
    </Link>
  ) : (
    maybeStoredDatasetName
  );
  const confirmString =
    isEditingMode || (dataset != null && dataset.dataSource.status == null) ? "Save" : "Import";
  const formErrors = getFormValidationSummary();
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
        <Hideable hidden={activeTabKey !== "data"}>
          {
            // We use the Hideable component here to avoid that the user can "tab"
            // to hidden form elements.
          }
          <DatasetSettingsDataTab
            key="SimpleAdvancedDataForm"
            dataset={dataset}
            form={form}
            activeDataSourceEditMode={activeDataSourceEditMode}
            onChange={handleDataSourceEditModeChange}
          />
        </Hideable>
      ),
    },

    {
      label: <span>Sharing & Permissions {formErrors.general ? errorIcon : null}</span>,
      key: "sharing",
      forceRender: true,
      children: (
        <Hideable hidden={activeTabKey !== "sharing"}>
          <DatasetSettingsSharingTab form={form} datasetId={datasetId} dataset={dataset} />
        </Hideable>
      ),
    },

    {
      label: <span>Metadata</span>,
      key: "general",
      forceRender: true,
      children: (
        <Hideable hidden={activeTabKey !== "general"}>
          <DatasetSettingsMetadataTab />
        </Hideable>
      ),
    },

    {
      label: <span> View Configuration {formErrors.defaultConfig ? errorIcon : ""}</span>,
      key: "defaultConfig",
      forceRender: true,
      children: (
        <Hideable hidden={activeTabKey !== "defaultConfig"}>
          {
            maybeDataSourceId ? (
              <DatasetSettingsViewConfigTab
                dataSourceId={maybeDataSourceId}
                dataStoreURL={dataset?.dataStore.url}
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
        <Hideable hidden={activeTabKey !== "deleteDataset"}>
          <DatasetSettingsDeleteTab datasetId={datasetId} />
        </Hideable>
      ),
    });

  return (
    <Form
      form={form}
      className="row container dataset-import"
      onFinish={handleSubmit}
      onFinishFailed={handleSubmit}
      onValuesChange={onValuesChange}
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
        <Spin size="large" spinning={isLoading}>
          {getMessageComponents()}

          <Card>
            <Tabs
              activeKey={activeTabKey}
              onChange={(key) => setActiveTabKey(key as TabKey)}
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
            <Button onClick={handleCancel}>Cancel</Button>
          </FormItem>
        </Spin>
      </Card>
    </Form>
  );
};

export default DatasetSettingsView;
