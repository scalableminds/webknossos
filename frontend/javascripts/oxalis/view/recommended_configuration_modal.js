// @flow

import { Modal, Table } from "antd";
import * as React from "react";
import _ from "lodash";

import type { RecommendedConfiguration } from "oxalis/store";
import { settingComments } from "admin/tasktype/recommended_configuration_view";
import messages, { settings } from "messages";

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
  config: RecommendedConfiguration,
  onOk: () => void,
  destroy: () => void,
};

type State = {
  visible: boolean,
};

export default class RecommendedConfigurationModal extends React.Component<Props, State> {
  state = {
    visible: true,
  };

  handleOk = () => {
    this.props.onOk();
    this.hide();
  };

  hide = () => {
    this.setState({ visible: false });
    this.props.destroy();
  };

  render() {
    return (
      <Modal
        maskClosable={false}
        visible={this.state.visible}
        title="Recommended Configuration"
        okText="Accept"
        cancelText="Decline"
        onOk={this.handleOk}
        onCancel={this.hide}
        width={750}
      >
        {messages["task.recommended_configuration"]}
        <Table
          style={{ marginTop: 20, maxHeight: 500, overflow: "auto" }}
          columns={columns}
          dataSource={_.map(this.props.config, (value, key) => ({
            name: settings[key],
            value: value.toString(),
            comment: settingComments[key] || "",
          }))}
          size="small"
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      </Modal>
    );
  }
}
