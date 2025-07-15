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

import features from "features";
import { useWkSelector } from "libs/react_hooks";
import messages from "messages";
import type React from "react";
import { useCallback } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Unicode } from "viewer/constants";
import { getReadableURLPart } from "viewer/model/accessors/dataset_accessor";

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
    hasFormErrors,
  } = useDatasetSettingsContext();
  const isUserAdmin = useWkSelector((state) => state.activeUser?.isAdmin || false);
  const location = useLocation();
  const navigate = useNavigate();
  const selectedKey = location.pathname.split("/").filter(Boolean).pop() || "data";

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

  const formErrors = hasFormErrors ? getFormValidationSummary() : {};
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
          icon: formErrors.general ? errorIcon : <TeamOutlined />,
          label: "Sharing & Permissions",
        },
        {
          key: "metadata",
          icon: formErrors.general ? errorIcon : <FileTextOutlined />,
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

  const navigateToTab = useCallback(
    ({ key }: { key: string }) => {
      if (key === selectedKey || key === "open") return;
      navigate(key);
    },
    [navigate, selectedKey],
  );

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
          onClick={navigateToTab}
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
          <Outlet />
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
