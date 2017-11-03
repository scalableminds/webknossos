// @flow
import React from "react";
import { Tabs, Icon } from "antd";
import TaskCreateFormView from "admin/views/task/task_create_form_view";
import TaskCreateBulkImportView from "admin/views/task/task_create_bulk_import_view";

const { TabPane } = Tabs;

const TaskCreateView = () => (
  <Tabs defaultActiveKey="1" className="container wide task-edit-administration">
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
      <TaskCreateBulkImportView />
    </TabPane>
  </Tabs>
);

export default TaskCreateView;
