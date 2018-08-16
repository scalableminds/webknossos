// @flow
import React from "react";
import { Tabs, Icon } from "antd";
import DatasetUploadView from "admin/dataset/dataset_upload_view"
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view"

const { TabPane } = Tabs;

const DatasetAddView = () => (
  <Tabs defaultActiveKey="1" className="container task-edit-administration">
    <TabPane
      tab={
        <span>
          <Icon type="upload" />Upload Dataset
        </span>
      }
      key="1"
    >
      <DatasetUploadView />
    </TabPane>
    <TabPane
      tab={
        <span>
          <Icon type="bars" />Add foreign Dataset
        </span>
      }
      key="2"
    >
      <DatasetAddForeignView />
    </TabPane>
  </Tabs>
);

export default DatasetAddView;
