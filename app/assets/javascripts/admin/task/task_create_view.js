// @flow
import { Tabs, Icon } from "antd";
import React from "react";

import TaskCreateBulkView from "admin/task/task_create_bulk_view";
import TaskCreateFormView from "admin/task/task_create_form_view";

const { TabPane } = Tabs;

const TaskCreateView = () => (
  <Tabs defaultActiveKey="1" className="container">
    <TabPane
      tab={
        <span>
          <Icon type="schedule" />Create Task
        </span>
      }
      key="1"
    >
      <TaskCreateFormView taskId={null} />
    </TabPane>
    <TabPane
      tab={
        <span>
          <Icon type="bars" />Bulk Creation
        </span>
      }
      key="2"
    >
      <TaskCreateBulkView />
    </TabPane>
  </Tabs>
);

export default TaskCreateView;
