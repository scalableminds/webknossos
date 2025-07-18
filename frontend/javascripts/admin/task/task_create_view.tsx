import { BarsOutlined, ScheduleOutlined } from "@ant-design/icons";
import TaskCreateBulkView from "admin/task/task_create_bulk_view";
import TaskCreateFormView from "admin/task/task_create_form_view";
import { Tabs, type TabsProps } from "antd";

const TaskCreateView = () => {
  const tabs: TabsProps["items"] = [
    {
      icon: <ScheduleOutlined />,
      label: "Create Task",
      key: "1",
      children: <TaskCreateFormView />,
    },
    {
      icon: <BarsOutlined />,
      label: "Bulk Creation",
      key: "2",
      children: <TaskCreateBulkView />,
    },
  ];

  return <Tabs defaultActiveKey="1" className="container" items={tabs} />;
};

export default TaskCreateView;
