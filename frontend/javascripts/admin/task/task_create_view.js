// @flow
import { BarsOutlined, ScheduleOutlined } from "@ant-design/icons";
import { Tabs } from "antd";
import React from "react";

import TaskCreateBulkView from "admin/task/task_create_bulk_view";
import TaskCreateFormView from "admin/task/task_create_form_view";

const { TabPane } = Tabs;

const TaskCreateView = () => (
  <Tabs defaultActiveKey="1" className="container">
    <TabPane
      tab={
        <span>
          <ScheduleOutlined />
          Create Task
        </span>
      }
      key="1"
    >
      <TaskCreateFormView taskId={null} />
    </TabPane>
    <TabPane
      tab={
        <span>
          <BarsOutlined />
          Bulk Creation
        </span>
      }
      key="2"
    >
      <TaskCreateBulkView />
    </TabPane>
  </Tabs>
);

export default TaskCreateView;
