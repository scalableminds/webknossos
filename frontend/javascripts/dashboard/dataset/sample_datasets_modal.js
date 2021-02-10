// @flow
import { Spin, Button, Modal, List } from "antd";
import React, { useState, useEffect } from "react";

import {
  getSampleDatasets,
  triggerSampleDatasetDownload,
  getDatastores,
} from "admin/admin_rest_api";
import { useInterval, useFetch } from "libs/react_helpers";
import { handleGenericError } from "libs/error_handling";
import type { APISampleDataset } from "types/api_flow_types";

type Props = {
  destroy: () => void,
  onOk?: () => any,
  organizationName: string,
};

function useSampleDatasets(
  organizationName,
): [Array<APISampleDataset>, Array<string>, (string) => Promise<void>] {
  const [datasets, setDatasets] = useState([]);
  const [failedDatasets, setFailedDatasets] = useState([]);
  const [pendingDatasets, setPendingDatasets] = useState([]);
  // Pick any non-wk-connect datastore - This feature will almost always be used if there is only one datastore anyways
  const datastore = useFetch(getDatastores, [], []).find(ds => !ds.isConnector && ds.allowsUpload);

  const updateFailedDatasets = sampleDatasets => {
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
  };

  const updatePendingDatasets = sampleDatasets => {
    setPendingDatasets(
      sampleDatasets
        .filter(dataset => dataset.status === "downloading")
        .map(dataset => dataset.name),
    );
  };

  const fetchSampleDatasets = async () => {
    if (datastore == null) return;
    const sampleDatasets = await getSampleDatasets(datastore.url, organizationName);
    setDatasets(sampleDatasets);

    updateFailedDatasets(sampleDatasets);
    updatePendingDatasets(sampleDatasets);
  };

  const handleSampleDatasetDownload = async (name: string) => {
    if (datastore == null) return;
    try {
      await triggerSampleDatasetDownload(datastore.url, organizationName, name);
      setPendingDatasets(pendingDatasets.concat(name));
    } catch (error) {
      handleGenericError(error);
    }
  };

  useEffect(() => {
    fetchSampleDatasets();
  }, [datastore]);

  // If there are pending datasets, poll download status periodically
  useInterval(fetchSampleDatasets, pendingDatasets.length ? 1000 : null);

  return [datasets, failedDatasets, handleSampleDatasetDownload];
}

const SampleDatasetsModal = ({ destroy, onOk, organizationName }: Props) => {
  const [datasets, failedDatasets, handleSampleDatasetDownload] = useSampleDatasets(
    organizationName,
  );

  const handleCancel = () => {
    destroy();
  };
  const handleOk = () => {
    if (onOk != null) onOk();
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
      onCancel={handleCancel}
      visible
      width={700}
      footer={[
        <Button key="ok" type="primary" onClick={handleOk}>
          Ok
        </Button>,
      ]}
    >
      <List
        dataSource={datasets}
        renderItem={item => (
          <List.Item style={{ alignItems: "center" }} actions={[getAction(item)]}>
            <List.Item.Meta
              style={{ whiteSpace: "pre-wrap" }}
              title={item.name}
              description={item.description}
            />
          </List.Item>
        )}
      />
    </Modal>
  );
};

export default SampleDatasetsModal;
