// @flow
/* eslint-disable react/prefer-stateless-function */
import React from "react";
import { Tabs } from "antd";
import DatasetUploadView from "admin/views/dataset/dataset_upload_view";
import DatasetRemoteView from "admin/views/dataset/dataset_remote_view";

const { TabPane } = Tabs;

class DatasetAddView extends React.PureComponent<*> {
  render() {
    return (
      <div className="container">
        <Tabs defaultActiveKey="1">
          <TabPane tab="Upload Dataset" key="1">
            <DatasetUploadView />
          </TabPane>
          <TabPane tab="Add NDStore Dataset" key="2">
            <DatasetRemoteView />
          </TabPane>
        </Tabs>
      </div>
    );
  }
}

export default DatasetAddView;
