// @flow
import { Spin, Button, Modal, List } from "antd";
import React, { useState, useEffect } from "react";
import _ from "lodash";

import {
  getSampleDatasets,
  triggerSampleDatasetDownload,
  getDatastores,
} from "admin/admin_rest_api";
import { useInterval } from "libs/react_helpers";
import { handleGenericError } from "libs/error_handling";
import type { APIDataStore, APISampleDataset } from "admin/api_flow_types";

type APISampleDatasetWithDatastore = {
  ...APISampleDataset,
  datastore: APIDataStore,
};

type Props = {
  destroy: () => void,
  onClose: () => any,
  organizationName: string,
};

function useDatastores(): [Array<APIDataStore>] {
  const [datastores, setDatastores] = useState([]);
  const fetchDatastores = async () => {
    const fetchedDatastores = await getDatastores();
    setDatastores(fetchedDatastores);
  };
  useEffect(() => {
    fetchDatastores();
  }, []);
  return [datastores];
}

function useSampleDatasets(
  datastores,
  organizationName,
  pendingDatasets,
  setPendingDatasets,
): [
  Array<APISampleDatasetWithDatastore>,
  (Array<APISampleDatasetWithDatastore>) => void,
  () => Promise<void>,
] {
  const [datasets, setDatasets] = useState([]);
  const fetchSampleDatasets = async () => {
    const fetchDatasetsPromises = datastores.map(async datastore => {
      const sampleDatasets = await getSampleDatasets(datastore.url, organizationName);
      return sampleDatasets.map(dataset => ({ ...dataset, datastore }));
    });
    const fetchedDatasets = _.flatten(await Promise.all(fetchDatasetsPromises));
    setDatasets(fetchedDatasets);

    // Remove present datasets from the pendingDatasets queue
    setPendingDatasets(
      _.without(
        pendingDatasets,
        ...datasets.filter(dataset => dataset.status === "present").map(dataset => dataset.name),
      ),
    );
  };
  useEffect(() => {
    fetchSampleDatasets();
  }, [datastores]);
  return [datasets, setDatasets, fetchSampleDatasets];
}

const SampleDatasetsModal = ({ destroy, onClose, organizationName }: Props) => {
  const [pendingDatasets, setPendingDatasets] = useState([]);
  const [datastores] = useDatastores();
  const [datasets, , fetchDatasets] = useSampleDatasets(
    datastores,
    organizationName,
    pendingDatasets,
    setPendingDatasets,
  );

  useInterval(fetchDatasets, pendingDatasets.length ? 1000 : null);

  const handleSampleDatasetDownload = async (name: string, datastore: APIDataStore) => {
    try {
      await triggerSampleDatasetDownload(datastore.url, organizationName, name);
      setPendingDatasets(pendingDatasets.concat(name));
    } catch (error) {
      handleGenericError(error);
    }
  };
  const handleClose = () => {
    onClose();
    destroy();
  };

  const getAction = ({ status, name, datastore }) => {
    switch (status) {
      case "available":
        return <Button onClick={() => handleSampleDatasetDownload(name, datastore)}>Add</Button>;
      case "downloading":
        return <Spin />;
      case "present":
        return "Added";
      default:
        throw new Error(`Unknown sample dataset status: ${status}`);
    }
  };

  return (
    <Modal
      title="Add a Sample Dataset"
      onCancel={handleClose}
      visible
      footer={[
        <Button key="ok" type="primary" onClick={handleClose}>
          Ok
        </Button>,
      ]}
    >
      <List
        dataSource={datasets}
        renderItem={item => (
          <List.Item style={{ alignItems: "center" }} actions={[getAction(item)]}>
            {item.name}
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default SampleDatasetsModal;
