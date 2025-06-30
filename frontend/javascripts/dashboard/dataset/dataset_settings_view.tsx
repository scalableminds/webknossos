import { ExclamationCircleOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Spin, Tabs, Tooltip } from "antd";
import features from "features";
import { useDatasetSettingsContext } from "dashboard/dataset/dataset_settings_context";
import DatasetSettingsDataTab from "dashboard/dataset/dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "dashboard/dataset/dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "dashboard/dataset/dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "dashboard/dataset/dataset_settings_sharing_tab";
import { useWkSelector } from "libs/react_hooks";
import React, { useCallback } from "react";
import { Link } from "react-router-dom";
import DatasetSettingsViewConfigTab from "./dataset_settings_viewconfig_tab";
import { Hideable } from "./helper_components";
import { Unicode } from "viewer/constants";
import messages from "messages";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

const FormItem = Form.Item;
const notImportedYetStatus = "Not imported yet.";

type TabKey = "data" | "general" | "defaultConfig" | "sharing" | "deleteDataset";

const DatasetSettingsView: React.FC = () => {
  const {
    form,
    isLoading,
    isEditingMode,
    dataset,
    datasetId,
    handleSubmit,
    handleCancel,
    handleDataSourceEditModeChange,
    onValuesChange,
    getFormValidationSummary,
  } = useDatasetSettingsContext();
  const isUserAdmin = useWkSelector((state) => state.activeUser?.isAdmin || false);
  const [activeTabKey, setActiveTabKey] = React.useState<TabKey>("data");

  const switchToProblematicTab = useCallback(() => {
    const validationSummary = getFormValidationSummary();

    if (validationSummary[activeTabKey]) {
      // Active tab is already problematic
      return;
    }

    // Switch to the earliest, problematic tab
    const problematicTab =
      ["data", "general", "defaultConfig"].find(
      (key) => validationSummary[key],
    );

    if (problematicTab) {
      setActiveTabKey(problematicTab as TabKey);
    }
  }, [getFormValidationSummary, activeTabKey]);

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
          <DatasetSettingsSharingTab  />
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
          <DatasetSettingsDeleteTab />
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
              onChange={(key) => setActiveTabKey(key as TabKey)} // Update active tab key
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
            <Button onClick={handleCancel}>Cancel</Button> {/* Use handleCancel from context */}
          </FormItem>
        </Spin>
      </Card>
    </Form>
  );
};

export default DatasetSettingsView;
