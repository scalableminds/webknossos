// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Icon } from "antd";
import React from "react";

import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import features from "features";

const { TabPane } = Tabs;

type Props = {
  history: RouterHistory,
};

const DatasetAddView = ({ history }: Props) => (
  <Tabs defaultActiveKey="1" className="container">
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
        <DatasetAddForeignView onAdded={() => history.push("/dashboard")} />
      </TabPane>
    ) : null}
  </Tabs>
);

export default withRouter(DatasetAddView);
