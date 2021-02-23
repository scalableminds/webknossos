// @flow
import { Spin, Button, Modal, List } from "antd";
import React, { useState, useEffect } from "react";
import type { BoundingBoxType } from "oxalis/constants";
import type { APIDataset } from "types/api_flow_types";

type Props = {
  destroy: () => void,
  onOk?: () => any,
  dataset: APIDataset,
  boundingBox: BoundingBoxType,
};


const ExportBoundingBoxModal = ({ destroy, onOk, dataset, boundingBox }: Props) => {


  const handleCancel = () => {
    destroy();
  };
  const handleOk = () => {
    if (onOk != null) onOk();
    destroy();
  };


  return (
    <Modal
      title="Export Bounding Box as Tiff Stack"
      onCancel={handleCancel}
      visible
      width={700}
      footer={[
        <Button key="ok" type="primary" onClick={handleOk}>
          close
        </Button>,
      ]}
    >

    </Modal>
  );
};

export default ExportBoundingBoxModal;
