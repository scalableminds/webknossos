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
import type { ItemType } from "antd/es/menu/interface";
import { useDatasetSettingsContext } from "dashboard/dataset/dataset_settings_context";
import DatasetSettingsDataTab from "dashboard/dataset/dataset_settings_data_tab";
import DatasetSettingsDeleteTab from "dashboard/dataset/dataset_settings_delete_tab";
import DatasetSettingsMetadataTab from "dashboard/dataset/dataset_settings_metadata_tab";
import DatasetSettingsSharingTab from "dashboard/dataset/dataset_settings_sharing_tab";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import type React from "react";
import { useCallback } from "react";
import {
  Redirect,
  Route,
  type RouteComponentProps,
  Switch,
  useHistory,
  useLocation,
} from "react-router-dom";
import { Unicode } from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";
import DatasetSettingsViewConfigTab from "./dataset_settings_viewconfig_tab";

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

  const titleString = isEditingMode ? "Dataset Settings" : "Import";
  const maybeStoredDatasetName = dataset?.name || datasetId;

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

  const menuItems: ItemType[] = [
    {
      label: titleString,
      type: "group",
      children: [
        {
          key: "data",
          icon: formErrors.data ? errorIcon : <CodeSandboxOutlined />,
          label: "Data Source",
        },
        {
          key: "sharing",
          icon: formErrors.sharing ? errorIcon : <TeamOutlined />,
          label: "Sharing & Permissions",
        },
        {
          key: "metadata",
          icon: formErrors.metadata ? errorIcon : <FileTextOutlined />,
          label: "Metadata",
        },
        {
          key: "defaultConfig",
          icon: formErrors.defaultConfig ? errorIcon : <SettingOutlined />,
          label: "View Configuration",
        },
        isUserAdmin && features().allowDeleteDatasets
          ? {
              key: "delete",
              icon: <DeleteOutlined />,
              label: "Delete",
            }
          : null,
      ],
    },
    { type: "divider" },
    {
      type: "group",
      children: isEditingMode
        ? [
            {
              key: "open",
              icon: <ExportOutlined />,
              label: "Open in WEBKNOSSOS",
              onClick: () =>
                window.open(
                  `/datasets/${dataset ? getReadableURLPart(dataset) : datasetId}/view`,
                  "_blank",
                  "noopener",
                ),
            },
          ]
        : [],
    },
  ];

  const breadcrumbItems = [
    {
      title: titleString,
    },
    { title: maybeStoredDatasetName },
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
          items={menuItems}
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
              component={DatasetSettingsViewConfigTab}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit/delete"
              component={DatasetSettingsDeleteTab}
            />
            <Route
              path="/datasets/:datasetNameAndId/edit"
              render={({ match }: RouteComponentProps<{ datasetNameAndId: string }>) => (
                <Redirect to={`/datasets/${match.params.datasetNameAndId}/edit/data`} />
              )}
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
