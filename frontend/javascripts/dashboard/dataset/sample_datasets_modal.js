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
  datastore,
  organizationName,
  pendingDatasets,
  setPendingDatasets,
): [Array<APISampleDataset>, Array<string>, () => Promise<void>] {
  const [datasets, setDatasets] = useState([]);
  const [failedDatasets, setFailedDatasets] = useState([]);
  const fetchSampleDatasets = async () => {
    if (datastore == null) return;
    const sampleDatasets = await getSampleDatasets(datastore.url, organizationName);
    setDatasets(sampleDatasets);

    // Datasets that were pending, but are now available again, failed to download
    setFailedDatasets(
      failedDatasets.concat(
        pendingDatasets.filter(pendingDataset =>
          sampleDatasets.find(
            dataset => dataset.name === pendingDataset && dataset.status === "available",
          ),
        ),
      ),
    );

    // Remove datasets from the pendingDatasets queue
    setPendingDatasets(
      _.without(
        pendingDatasets,
        ...sampleDatasets
          .filter(dataset => dataset.status !== "downloading")
          .map(dataset => dataset.name),
      ),
    );
  };
  useEffect(() => {
    fetchSampleDatasets();
  }, [datastore]);
  return [datasets, failedDatasets, fetchSampleDatasets];
}

const SampleDatasetsModal = ({ destroy, onClose, organizationName }: Props) => {
  const [pendingDatasets, setPendingDatasets] = useState([]);
  const [datastores] = useDatastores();
  const datastore = datastores[0];
  const [datasets, failedDatasets, fetchDatasets] = useSampleDatasets(
    datastore,
    organizationName,
    pendingDatasets,
    setPendingDatasets,
  );

  useInterval(fetchDatasets, pendingDatasets.length ? 1000 : null);

  const handleSampleDatasetDownload = async (name: string) => {
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

  const getAction = ({ status, name }) => {
    if (failedDatasets.includes(name)) status = "failed";
    switch (status) {
      case "available":
        return <Button onClick={() => handleSampleDatasetDownload(name)}>Add</Button>;
      case "downloading":
        return <Spin />;
      case "present":
        return "Added";
      case "failed":
        return "Download Error";
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
