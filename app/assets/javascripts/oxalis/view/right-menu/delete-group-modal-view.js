// @flow
import * as React from "react";
import { Modal, Button } from "antd";

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
      title="Do you really want to remove this group?"
      onOk={onJustDeleteGroup}
      onCancel={onCancel}
      footer={[
        <Button key="back" onClick={onCancel}>
          Cancel
        </Button>,
        <Button key="submit-groups-only" onClick={onJustDeleteGroup}>
          Remove group only
        </Button>,
        <Button key="submit-all" type="primary" onClick={onDeleteGroupAndTrees}>
          Remove group and subtrees
        </Button>,
      ]}
    >
      Do you really want to remove the selected group? If you want to remove just the group and keep
      the sub trees select &ldquo;Remove group only&rdquo;. If you want to remove both select
      &ldquo;Remove group and subtrees&rdquo;.
    </Modal>
  );
}
