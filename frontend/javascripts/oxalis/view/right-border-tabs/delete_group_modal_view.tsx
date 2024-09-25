import { Modal, Button } from "antd";
import messages from "messages";

type Props = {
  onJustDeleteGroup: () => void;
  onDeleteGroupAndChildren: () => void;
  onCancel: () => void;
};

export default function DeleteGroupModalView({
  onJustDeleteGroup,
  onDeleteGroupAndChildren,
  onCancel,
}: Props) {
  return (
    <Modal
      open
      title={messages["tracing.group_deletion_message"]}
      onOk={onJustDeleteGroup}
      onCancel={onCancel}
      width={620}
      footer={[
        <Button key="submit-all" danger onClick={onDeleteGroupAndChildren}>
          Remove group including all children
        </Button>,
        <Button key="submit-groups-only" type="primary" onClick={onJustDeleteGroup}>
          Remove group and keep children
        </Button>,
      ]}
    >
      When selecting &quot;Remove group and keep children&quot;, the children will be moved to the
      level of the original group.
    </Modal>
  );
}
