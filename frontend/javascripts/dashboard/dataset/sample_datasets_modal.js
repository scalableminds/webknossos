// @flow
import { Spin, Button, Modal, List } from "antd";
import React, { useState, useEffect } from "react";
import _ from "lodash";

import { getSampleDatasets, triggerSampleDatasetDownload } from "admin/admin_rest_api";
import { useInterval } from "libs/react_helpers";

type Props = {
  destroy: () => void,
  onClose: () => any,
  organizationName: string,
};

const SampleDatasetsModal = ({ destroy, onClose, organizationName }: Props) => {
  const [datasets, setDatasets] = useState([]);
  const [pendingDatasets, setPendingDatasets] = useState([]);
  const fetchSampleDatasets = async () => {
    const sampleDatasets = await getSampleDatasets("http://localhost:9000", organizationName);
    setDatasets(sampleDatasets);
    // Remove present datasets from the pendingDatasets queue
    setPendingDatasets(
      _.without(
        pendingDatasets,
        ...sampleDatasets
          .filter(dataset => dataset.status === "present")
          .map(dataset => dataset.name),
      ),
    );
  };
  useEffect(() => {
    fetchSampleDatasets();
  }, []);

  useInterval(fetchSampleDatasets, pendingDatasets.length ? 500 : null);

  const handleClose = () => {
    onClose();
    destroy();
  };

  const getAction = ({ status, name }) => {
    switch (status) {
      case "available":
        return (
          <Button
            onClick={() => {
              triggerSampleDatasetDownload("http://localhost:9000", organizationName, name);
              setPendingDatasets(pendingDatasets.concat(name));
            }}
          >
            Add
          </Button>
        );
      case "downloading":
        return <Spin loading />;
      case "present":
        return "Already added";
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
