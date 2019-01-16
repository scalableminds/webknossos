// @flow
import * as React from "react";
import { Modal, Button } from "antd";
import messages from "messages";

type Props = {
  onJustDeleteGroup: () => void,
  onDeleteGroupAndTrees: () => void,
  onCancel: () => void,
};

export default function DeleteGroupModalView({
  onJustDeleteGroup,
  onDeleteGroupAndTrees,
  onCancel,
}: Props) {
  return (
    <Modal
      visible
      title={messages["tracing.group_deletion_message"]}
      onOk={onJustDeleteGroup}
      onCancel={onCancel}
      footer={[
        <Button key="back" onClick={onCancel}>
          Cancel
        </Button>,
        <Button key="submit-all" onClick={onDeleteGroupAndTrees}>
          Remove group recursively
        </Button>,
        <Button key="submit-groups-only" type="primary" onClick={onJustDeleteGroup}>
          Remove group only
        </Button>,
      ]}
    >
      Do you really want to remove the selected group? If you want to remove the group with all its
      trees and subgroups recursively, select &quot;Remove group recursively&quot;. If you want to
      remove just the group and keep the subtrees and subgroups select &quot;Remove group
      only&quot;.
    </Modal>
  );
}
