import { Modal } from "antd";
import Markdown from "libs/markdown_adapter";
import type React from "react";
import { useCallback, useEffect, useState } from "react";

type Props = {
  description: string;
  destroy: () => void;
  title: string;
};

const NewTaskDescriptionModal: React.FC<Props> = ({ description, destroy, title }) => {
  const [mayClose, setMayClose] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  useEffect(() => {
    const timeoutId = setTimeout(
      () => {
        setMayClose(true);
      },
      process.env.NODE_ENV === "production" ? 10000 : 2000,
    );

    return () => {
      clearTimeout(timeoutId);
    };
  }, []);

  const handleOk = useCallback(() => {
    if (!mayClose) {
      return;
    }

    setIsOpen(false);
    destroy();
  }, [mayClose, destroy]);

  return (
    <Modal
      mask={{ closable: false }}
      open={isOpen}
      title={title}
      onOk={handleOk}
      onCancel={handleOk}
      okButtonProps={{ loading: !mayClose, disabled: !mayClose }}
      footer={(_, { OkBtn }) => <OkBtn />} // no cancel button
    >
      <Markdown>{description}</Markdown>
    </Modal>
  );
};

export default NewTaskDescriptionModal;
