// @flow
import * as React from "react";
import { Modal, Button } from "antd";

type Props = {
  numberOfGroups: number,
  onJustDeleteGroups: () => void,
  onDeleteGroupsAndTrees: () => void,
  onCancel: () => void,
};

export default function DeleteGroupsModalView({
  numberOfGroups,
  onJustDeleteGroups,
  onDeleteGroupsAndTrees,
  onCancel,
}: Props) {
  return (
    <Modal
      visible
      title="Do you really want to remove the selected groups?"
      onOk={onJustDeleteGroups}
      onCancel={onCancel}
      footer={[
        <Button key="back" onClick={onCancel}>
          Cancel
        </Button>,
        <Button key="submit-groups-only" onClick={onJustDeleteGroups}>
          Remove groups only
        </Button>,
        <Button key="submit-all" type="primary" onClick={onDeleteGroupsAndTrees}>
          Remove groups and subtrees
        </Button>,
      ]}
    >
      There are {numberOfGroups} groups selected. Do you really want to remove them? If you want to
      remove just the groups and keep the sub trees select &ldquo;Remove groups only&rdquo;. If you
      want to remove both select &ldquo;Remove groups and subtrees&rdquo;.
    </Modal>
  );
}
