import { settingComments } from "admin/tasktype/recommended_configuration_view";
import { Modal, Table } from "antd";
import { map } from "lodash";
import messages, { settings } from "messages";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import type { RecommendedConfiguration } from "viewer/store";

const columns = [
  {
    title: "Setting",
    dataIndex: "name",
  },
  {
    title: "Value",
    dataIndex: "value",
  },
  {
    title: "Comment",
    dataIndex: "comment",
  },
];

type Props = {
  config: RecommendedConfiguration;
  onOk: () => void;
  destroy: () => void;
};

const RecommendedConfigurationModal: React.FC<Props> = ({ config, onOk, destroy }) => {
  const [isOpen, setIsOpen] = useState(true);

  const hide = useCallback(() => {
    setIsOpen(false);
    destroy();
  }, [destroy]);

  const handleOk = useCallback(() => {
    onOk();
    hide();
  }, [onOk, hide]);

  const configurationEntries = useMemo(
    () =>
      map(config, (value, key) => {
        const settingsKey = key as keyof RecommendedConfiguration;
        return {
          name: key in settings ? settings[settingsKey] : null,
          value: value?.toString(),
          comment: settingComments[settingsKey] || "",
        };
      }),
    [config],
  );

  return (
    <Modal
      maskClosable={false}
      open={isOpen}
      title="Recommended Configuration"
      okText="Accept"
      cancelText="Decline"
      onOk={handleOk}
      onCancel={hide}
      width={750}
    >
      {messages["task.recommended_configuration"]}
      <Table
        style={{
          marginTop: 20,
          maxHeight: 500,
          overflow: "auto",
        }}
        columns={columns}
        dataSource={configurationEntries}
        size="small"
        pagination={false}
        scroll={{
          x: "max-content",
        }}
      />
    </Modal>
  );
};

export default RecommendedConfigurationModal;
