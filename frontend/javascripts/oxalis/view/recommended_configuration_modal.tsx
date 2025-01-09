import { settingComments } from "admin/tasktype/recommended_configuration_view";
import { Modal, Table } from "antd";
import _ from "lodash";
import messages, { settings } from "messages";
import type { RecommendedConfiguration } from "oxalis/store";
import * as React from "react";
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
type State = {
  isOpen: boolean;
};
export default class RecommendedConfigurationModal extends React.Component<Props, State> {
  state: State = {
    isOpen: true,
  };

  handleOk = () => {
    this.props.onOk();
    this.hide();
  };

  hide = () => {
    this.setState({
      isOpen: false,
    });
    this.props.destroy();
  };

  render() {
    const configurationEntries = _.map(this.props.config, (value, key) => {
      // @ts-ignore Typescript doesn't infer that key will be of type keyof RecommendedConfiguration
      const settingsKey: keyof RecommendedConfiguration = key;
      return {
        name: key in settings ? settings[settingsKey] : null,
        value: value?.toString(),
        comment: settingComments[settingsKey] || "",
      };
    });
    return (
      <Modal
        maskClosable={false}
        open={this.state.isOpen}
        title="Recommended Configuration"
        okText="Accept"
        cancelText="Decline"
        onOk={this.handleOk}
        onCancel={this.hide}
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
  }
}
