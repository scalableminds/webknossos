// @flow

import * as React from "react";
import { Link } from "react-router-dom";
import { getScripts, getUserConfiguration, updateUserConfiguration } from "admin/admin_rest_api";
import type { APIScriptType } from "admin/api_flow_types";
import type { UserConfigurationType } from "oxalis/store";
import { Alert, Select, Row, Col, Spin } from "antd";
import { AsyncButton } from "components/async_clickables";

const { Option } = Select;

type State = {
  isLoading: boolean,
  scripts: Array<APIScriptType>,
  userConfig: ?UserConfigurationType,
};

class UserScriptsView extends React.PureComponent<{}, State> {
  state = {
    isLoading: true,
    scripts: [],
    userConfig: null,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const [scripts, userConfig] = await Promise.all([getScripts(), getUserConfiguration()]);
    this.setState({
      isLoading: false,
      scripts,
      userConfig,
    });
  }

  renderPlaceholder() {
    return this.state.isLoading ? null : (
      <React.Fragment>
        {"There are no scripts. You can "}
        <Link to="/scripts/create">add a script</Link>
        {
          " which can be automatically executed in tasks. Scripts can, for example, be used to add custom keyboard shortcuts."
        }
        <br />
        {"See the "}
        <Link to="/assets/docs/frontend-api/index.html" target="_blank">
          Frontend API Documentation
        </Link>
        {" for more information."}
      </React.Fragment>
    );
  }

  onSave = async () => {
    if (this.state.userConfig != null) {
      await updateUserConfiguration(this.state.userConfig);
    }
  };

  render() {
    const scriptsValue =
      this.state.userConfig != null ? this.state.userConfig.activeUserScriptIds || [] : [];

    return (
      <Row type="flex" justify="center" style={{ padding: 50 }} align="middle">
        <Col span={16}>
          <h3>Manage User Scripts</h3>
          <Alert
            message="Add and define scripts"
            description={
              <span>
                You can run custom scripts to tweak webKnossos&#39; behavior for your needs (e.g.,
                for custom shortcuts). If you add a script, the corresponding code will be executed
                when opening an annotation or dataset.
              </span>
            }
            type="info"
            showIcon
          />

          <Spin spinning={this.state.isLoading} size="large">
            <div style={{ margin: "24px 0px" }}>
              <span style={{ marginRight: 12 }}>Select one or multiple scripts:</span>
              <Select
                mode="multiple"
                style={{ width: 400 }}
                value={scriptsValue}
                onChange={activeUserScriptIds => {
                  const shape = {
                    userConfig: { ...this.state.userConfig, activeUserScriptIds },
                  };

                  console.log("shape", shape);
                  return this.setState({
                    userConfig: { ...this.state.userConfig, activeUserScriptIds },
                  });
                }}
              >
                <Option value="basic">Philipps Basic Shortcuts</Option>
                <Option value="advanced">Philipps Advanced Shortcuts</Option>
                {this.state.scripts.map(script => (
                  <Option key={script.id} value={script.id}>
                    {script.name}
                  </Option>
                ))}
              </Select>
            </div>

            <Row type="flex" justify="center" align="middle">
              <Col span={2}>
                <AsyncButton type="primary" onClick={this.onSave}>
                  Save
                </AsyncButton>
              </Col>
            </Row>
          </Spin>
        </Col>
      </Row>
    );
  }
}

export default UserScriptsView;
