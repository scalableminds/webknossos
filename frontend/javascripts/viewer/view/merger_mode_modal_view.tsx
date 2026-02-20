import { Button, Flex, Modal, Spin, Tooltip, Typography } from "antd";

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
        !isCloseable ? (
          <Tooltip title="At the moment, the existing trees are used to merge segments. This dialog can be closed after the initial processing has been completed.">
            {closeButton}
          </Tooltip>
        ) : (
          closeButton
        )
      }
    >
      <Typography.Paragraph>
        You just enabled the merger mode. This mode allows to merge segmentation cells by creating
        trees and nodes. Each tree maps the marked segments (the ones where nodes were created in)
        to one new segment. Create separate trees for different segments.
      </Typography.Paragraph>
      <Typography.Paragraph>
        Additionally available keyboard shortcuts:
        <table
          style={{
            marginTop: 8,
          }}
        >
          <tbody>
            <tr>
              <td
                style={{
                  paddingRight: 12,
                }}
              >
                <Typography.Text keyboard>9</Typography.Text>
              </td>
              <td>Enable / disable displaying the segmentation.</td>
            </tr>
          </tbody>
        </table>
      </Typography.Paragraph>
      {!isCloseable ? (
        <Flex justify="center">
          <Spin
            style={{
              marginTop: 16,
            }}
            tip={`${Math.round(progress)} %`}
          />
        </Flex>
      ) : null}
    </Modal>
  );
}
