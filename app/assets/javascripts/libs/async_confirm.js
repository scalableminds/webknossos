// @flow
import { Modal } from "antd";

const { confirm } = Modal;

export async function binaryConfirm(title: string, content: string): Promise<boolean> {
  return new Promise(resolve => {
    confirm({
      title,
      content,
      okText: "Yes",
      okType: "danger",
      cancelText: "No",
      onOk() {
        resolve(true);
      },
      onCancel() {
        resolve(false);
      },
    });
  });
}

export default {};
