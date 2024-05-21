import * as React from "react";
import { Modal, Button, Spin, Tooltip, Alert } from "antd";
import { useSelector } from "react-redux";
import { hasVisibleUint64Segmentation } from "oxalis/model/accessors/dataset_accessor";
type Props = {
  isCloseable: boolean;
  onClose: () => void;
  progress: number;
};
export default function MergerModeModalView({ isCloseable, onClose, progress }: Props) {
  const isUint64SegmentationVisible = useSelector(hasVisibleUint64Segmentation);

  const closeButton = (
    <Button type="primary" onClick={onClose} disabled={!isCloseable}>
      Close
    </Button>
  );
  return (
    <Modal
      open
      title="Merger mode enabled"
      closable={false}
      width={600}
      centered
      footer={
        <div className="centered-children">
          {!isCloseable ? (
            <Tooltip title="At the moment, the existing trees are used to merge segments. This dialog can be closed after the initial processing has been completed.">
              {closeButton}
            </Tooltip>
          ) : (
            closeButton
          )}
        </div>
      }
    >
      {isUint64SegmentationVisible && (
        <Alert
          style={{ marginBottom: 12 }}
          message="Warning"
          description="The merger mode is limited to 32-bit. However, your current segmentation layer uses
          64 bits. The rendering of segment ids greater than or equal to 2^32 will be incorrect."
          type="warning"
          showIcon
        />
      )}
      You just enabled the merger mode. This mode allows to merge segmentation cells by creating
      trees and nodes. Each tree maps the marked segments (the ones where nodes were created in) to
      one new segment. Create separate trees for different segments.
      <br />
      <br />
      Additionally available keyboard shortcuts:
      <table
        className="table-data-starting-at-top"
        style={{
          marginTop: 8,
        }}
      >
        <tbody>
          <tr>
            <td
              style={{
                paddingRight: 24,
              }}
            >
              9
            </td>
            <td>Enable / disable displaying the segmentation.</td>
          </tr>
        </tbody>
      </table>
      {!isCloseable ? (
        <div className="centered-children">
          <Spin
            style={{
              marginTop: 16,
            }}
            tip={`${Math.round(progress)} %`}
          />
        </div>
      ) : null}
    </Modal>
  );
}
