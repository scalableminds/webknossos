// @flow
import React from "react";
import { Tabs, Icon } from "antd";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import features from "features";
import { withRouter } from "react-router-dom";
import type { RouterHistory } from "react-router-dom";

const { TabPane } = Tabs;

type Props = {
  history: RouterHistory,
};

const DatasetAddView = ({ history }: Props) => (
  <Tabs defaultActiveKey="1" className="container task-edit-administration">
    <TabPane
      tab={
        <span>
          <Icon type="upload" />Upload Dataset
        </span>
      }
      key="1"
    >
      <DatasetUploadView
        onUploaded={datasetName => {
          const url = `/datasets/${datasetName}/import`;
          history.push(url);
        }}
      />
    </TabPane>
    {features().addForeignDataset ? (
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
    ) : null}
  </Tabs>
);

export default withRouter(DatasetAddView);
