// @flow
import * as React from "react";
import { Modal, Button, Spin, Tooltip } from "antd";

type Props = {
  isCloseable: boolean,
  onClose: () => void,
};

export default function MergerModeModalView({ isCloseable, onClose }: Props) {
  return (
    <Modal
      visible
      title="Merger mode enabled"
      closable={false}
      centered
      footer={
        <div className="centered-children">
          {!isCloseable ? (
            <Tooltip title="At the moment, the existing trees are used to merge segments. This dialog can be closed after the initial processing has been completed.">
              <Button type="primary" onClick={onClose} disabled>
                Close
              </Button>
            </Tooltip>
          ) : (
            <Button type="primary" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      }
    >
      You just enabled the merger mode. This mode allows to merge segmentation cells by creating
      trees and nodes. Each tree maps the marked segments (the ones where nodes were created in) to
      one new segment. Create separate trees for different segements.
      <br />
      <br />
      Additionally available keyboard shortcuts:
      <table className="table-data-starting-at-top" style={{ marginTop: 8 }}>
        <tr>
          <td style={{ paddingRight: 24 }}>8</td>
          <td>
            Replace the color of the current active tree and its mapped segments with a new one
          </td>
        </tr>
        <tr>
          <td style={{ paddingRight: 24 }}>9</td>
          <td>Enable / disable displaying the segmentation.</td>
        </tr>
      </table>
      {!isCloseable ? (
        <div className="centered-children">
          <Spin style={{ marginTop: 16 }} />
        </div>
      ) : null}
    </Modal>
  );
}
