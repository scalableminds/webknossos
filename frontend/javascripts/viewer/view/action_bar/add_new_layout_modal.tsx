import { Input, Modal } from "antd";
import type React from "react";
import { memo, useCallback, useState } from "react";

type Props = {
  addLayout: (arg0: string) => void;
  isOpen: boolean;
  onCancel: () => void;
};

const AddNewLayoutModal: React.FC<Props> = ({ addLayout, isOpen, onCancel }) => {
  const [value, setValue] = useState("");

  const onConfirm = useCallback(() => {
    addLayout(value);
    setValue("");
  }, [addLayout, value]);

  const handleChange = useCallback((evt: React.ChangeEvent<HTMLInputElement>) => {
    setValue(evt.target.value);
  }, []);

  return (
    <Modal title="Add a new layout" open={isOpen} onOk={onConfirm} onCancel={onCancel}>
      <Input
        placeholder="Layout Name"
        value={value}
        onChange={handleChange}
        autoFocus
        onPressEnter={onConfirm}
      />
    </Modal>
  );
};

export default memo(AddNewLayoutModal);
