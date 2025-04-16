import { Button, Modal, Spin, Tooltip } from "antd";

type Props = {
  isCloseable: boolean;
  onClose: () => void;
  progress: number;
};

export default function MergerModeModalView({ isCloseable, onClose, progress }: Props) {
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
