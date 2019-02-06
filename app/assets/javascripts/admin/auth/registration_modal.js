// @flow
import React from "react";
import { Modal } from "antd";

import RegistrationForm from "./registration_form";

type Props = {
  onOk: boolean => void,
  destroy: Function,
};

export default function RegistrationModal({ onOk, destroy }: Props) {
  const onRegistered = (val: boolean) => {
    onOk(val);
    destroy();
  };

  return (
    <Modal title="Register" onCancel={destroy} visible footer={null} maskClosable={false}>
      <RegistrationForm
        onRegistered={onRegistered}
        label="You have to register to create a tracing."
      />
    </Modal>
  );
}
