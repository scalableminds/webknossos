import { FileAddOutlined, UploadOutlined } from "@ant-design/icons";
import AdminPage from "admin/admin_page";
import TaskCreateBulkView from "admin/task/task_create_bulk_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import { Tabs, type TabsProps, theme } from "antd";
import { useState } from "react";

enum TaskCreateMode {
  Single = "single",
  Bulk = "bulk",
}

const TaskCreateView = () => {
  const { token } = theme.useToken();
  const initialTab =
    location.hash === `#${TaskCreateMode.Bulk}` ? TaskCreateMode.Bulk : TaskCreateMode.Single;
  const [activeTab, setActiveTab] = useState<TaskCreateMode>(initialTab);

  const tabs: TabsProps["items"] = [
    {
      icon: <FileAddOutlined />,
      label: "Single Task",
      key: TaskCreateMode.Single,
    },
    {
      icon: <UploadOutlined />,
      label: "Bulk Import",
      key: TaskCreateMode.Bulk,
    },
  ];

  const handleTabChange = (key: string) => {
    const nextTab = key as TaskCreateMode;
    setActiveTab(nextTab);
    const hash = nextTab === TaskCreateMode.Single ? "" : `#${nextTab}`;
    window.history.replaceState(null, "", `${window.location.pathname}${hash}`);
  };

  return (
    <AdminPage
      title="Create Tasks"
      descriptionURI="https://docs.webknossos.org/webknossos/tasks_projects/tasks.html"
      description="Create individual tasks with detailed settings or import larger batches from CSV."
      contentMaxWidth={960}
      subNavigation={
        <Tabs
          activeKey={activeTab}
          items={tabs}
          onChange={handleTabChange}
          tabBarGutter={token.marginLG}
          tabBarStyle={{ margin: 0 }}
        />
      }
    >
      {activeTab === TaskCreateMode.Single ? (
        <TaskCreateFormView embedded />
      ) : (
        <TaskCreateBulkView />
      )}
    </AdminPage>
  );
};

export default TaskCreateView;
