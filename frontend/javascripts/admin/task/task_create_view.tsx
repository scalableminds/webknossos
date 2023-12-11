import { BarsOutlined, ScheduleOutlined } from "@ant-design/icons";
import { Tabs, TabsProps } from "antd";
import React from "react";
import TaskCreateBulkView from "admin/task/task_create_bulk_view";
import TaskCreateFormView from "admin/task/task_create_form_view";

const TaskCreateView = () => {
  const tabs: TabsProps["items"] = [
    {
      label: (
        <span>
          <ScheduleOutlined />
          Create Task
        </span>
      ),
      key: "1",
      children: <TaskCreateFormView taskId={null} />,
    },
    {
      label: (
        <span>
          <BarsOutlined />
          Bulk Creation
        </span>
      ),
      key: "2",
      children: <TaskCreateBulkView />,
    },
  ];

  return <Tabs defaultActiveKey="1" className="container" items={tabs} />;
};

export default TaskCreateView;
