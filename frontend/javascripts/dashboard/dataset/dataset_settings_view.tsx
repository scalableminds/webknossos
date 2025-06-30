import {
  CodeSandboxOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
  ExportOutlined,
  FileTextOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Alert, Breadcrumb, Button, Form, Layout, Menu, Tooltip } from "antd";
import { useDatasetSettingsContext } from "dashboard/dataset/dataset_settings_context";
import DatasetSettingsDataTab from "dashboard/dataset/dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "dashboard/dataset/dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "dashboard/dataset/dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "dashboard/dataset/dataset_settings_sharing_tab";
import DatasetSettingsViewConfigTab from "./dataset_settings_viewconfig_tab";
import { useWkSelector } from "libs/react_hooks";
import type React from "react";
import { useCallback } from "react";
import { Link, Route, useHistory, useLocation, Switch } from "react-router-dom";
import { Unicode } from "viewer/constants";
import messages from "messages";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import type { MenuItemGroupType } from "antd/es/menu/interface";

const { Sider, Content } = Layout;
const FormItem = Form.Item;
const notImportedYetStatus = "Not imported yet.";

const BREADCRUMB_LABELS = {
  data: "Data Source",
  sharing: "Sharing & Permissions",
  metadata: "Metadata",
  defaultConfig: "View Configuration",
  delete: "Delete Dataset",
};

const MENU_ITEMS: MenuItemGroupType[] = [
  {
    label: "Dataset Settings",
    type: "group",
    children: [
      {
        key: "data",
        icon: <CodeSandboxOutlined />,
        label: "Data Source",
      },
      {
        key: "sharing",
        icon: <TeamOutlined />,
        label: "Sharing & Permissions",
      },
      {
        key: "metadata",
        icon: <FileTextOutlined />,
        label: "Metadata",
      },
      {
        key: "defaultConfig",
        icon: <SettingOutlined />,
        label: "View Configuration",
      },
      {
        key: "delete",
        icon: <DeleteOutlined />,
        label: "Delete",
      },
    ],
  },
  { type: "divider" },
  {
    type: "group",
    children: [
      {
        key: "open",
        icon: <ExportOutlined />,
        label: "Open in WEBKNOSSOS",
      },
    ],
  },
];

// if (isUserAdmin && features().allowDeleteDatasets) {
//   MENU_ITEMS[0].children.push();
// }

const DatasetSettingsView: React.FC = () => {
  const {
    form,
    isEditingMode,
    dataset,
    datasetId,
    handleSubmit,
    handleCancel,
    onValuesChange,
    getFormValidationSummary,
  } = useDatasetSettingsContext();
  const isUserAdmin = useWkSelector((state) => state.activeUser?.isAdmin || false);
  const location = useLocation();
  const history = useHistory();
  const selectedKey = location.pathname.split("/").filter(Boolean).pop() || "data";

  // const switchToProblematicTab = useCallback(() => {
  //   const validationSummary = getFormValidationSummary();

  //   if (validationSummary[activeTabKey]) {
  //     // Active tab is already problematic
  //     return;
  //   }

  //   // Switch to the earliest, problematic tab
  //   const problematicTab = ["data", "general", "defaultConfig"].find(
  //     (key) => validationSummary[key],
  //   );

  //   if (problematicTab) {
  //     setActiveTabKey(problematicTab as TabKey);
  //   }
  // }, [getFormValidationSummary, activeTabKey]);

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

  const breadcrumbItems = [
    {
      title: "Dataset Settings",
    },
    {
      title: BREADCRUMB_LABELS[selectedKey as keyof typeof BREADCRUMB_LABELS],
    },
  ];

  return (
    <Layout
      style={{ minHeight: "calc(100vh - 64px)", backgroundColor: "var(--ant-layout-body-bg)" }}
    >
      <Sider width={300}>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          style={{ height: "100%", padding: 24 }}
          items={MENU_ITEMS}
          onClick={({ key }) => history.push(`/datasets/${datasetId}/edit/${key}`)}
        />
      </Sider>
      <Content style={{ padding: "32px", minHeight: 280, maxWidth: 1000 }}>
        <Breadcrumb style={{ marginBottom: "16px" }} items={breadcrumbItems} />
        {getMessageComponents()}
        <Form
          form={form}
          onFinish={handleSubmit}
          onFinishFailed={handleSubmit}
          onValuesChange={onValuesChange}
          layout="vertical"
        >
          <Switch>
            <Route
              path="/datasets/:datasetNameAndId/edit/data"
              component={DatasetSettingsDataTab}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit/sharing"
              component={DatasetSettingsSharingTab}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit/metadata"
              component={DatasetSettingsMetadataTab}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit/defaultConfig"
              render={() => (
                <DatasetSettingsViewConfigTab
                  dataSourceId={maybeDataSourceId}
                  dataStoreURL={dataset?.dataStore.url}
                />
              )}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit/delete"
              component={DatasetSettingsDeleteTab}
            />
          </Switch>
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
        </Form>
      </Content>
    </Layout>
  );
};

export default DatasetSettingsView;
