// @flow
import { type RouterHistory, withRouter } from "react-router-dom";
import { Tabs, Icon } from "antd";
import React, { useState, useEffect } from "react";

import DatasetAddForeignView from "admin/dataset/dataset_add_foreign_view";
import DatasetAddWkConnectView from "admin/dataset/dataset_add_wk_connect_view";
import DatasetUploadView from "admin/dataset/dataset_upload_view";
import features from "features";
import { getDatastores } from "admin/admin_rest_api";
import type { APIDataStore } from "admin/api_flow_types";

const { TabPane } = Tabs;

type Props = {
  history: RouterHistory,
};

// TODO: Replace with useFetch once it is merged
function useDatastores(): { own: Array<APIDataStore>, wkConnect: Array<APIDataStore> } {
  const [datastores, setDatastores] = useState({ own: [], wkConnect: [] });
  const fetchDatastores = async () => {
    const fetchedDatastores = await getDatastores();
    const categorizedDatastores = {
      own: fetchedDatastores.filter(ds => !ds.isForeign && !ds.isConnector),
      wkConnect: fetchedDatastores.filter(ds => ds.isConnector),
    };
    setDatastores(categorizedDatastores);
  };
  useEffect(() => {
    fetchDatastores();
  }, []);
  return datastores;
}

const DatasetAddView = ({ history }: Props) => {
  const datastores = useDatastores();
  return (
    <Tabs defaultActiveKey="1" className="container">
      <TabPane
        tab={
          <span>
            <Icon type="upload" />
            Upload Dataset
          </span>
        }
        key="1"
      >
        <DatasetUploadView
          datastores={datastores.own}
          onUploaded={(organization: string, datasetName: string) => {
            const url = `/datasets/${organization}/${datasetName}/import`;
            history.push(url);
          }}
        />
      </TabPane>
      {datastores.wkConnect.length && (
        <TabPane
          tab={
            <span>
              <Icon type="plus" />
              Add wk-connect Dataset
            </span>
          }
          key="2"
        >
          <DatasetAddWkConnectView
            datastores={datastores.wkConnect}
            onAdded={(organization: string, datasetName: string) => {
              const url = `/datasets/${organization}/${datasetName}/import`;
              history.push(url);
            }}
          />
        </TabPane>
      )}
      {features().addForeignDataset && (
        <TabPane
          tab={
            <span>
              <Icon type="bars" />
              Add Foreign Dataset
            </span>
          }
          key="3"
        >
          <DatasetAddForeignView onAdded={() => history.push("/dashboard")} />
        </TabPane>
      )}
    </Tabs>
  );
};

export default withRouter(DatasetAddView);
