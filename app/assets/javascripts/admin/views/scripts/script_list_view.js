// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import { getScripts, deleteScript } from "admin/admin_rest_api";
import type { APIScriptType } from "admin/api_flow_types";

const { Column } = Table;
const { Search } = Input;

type State = {
  isLoading: boolean,
  scripts: Array<APIScriptType>,
  searchQuery: string,
};

class ScriptListView extends React.PureComponent<{}, State> {
  state = {
    isLoading: true,
    scripts: [],
    searchQuery: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    const scripts = await getScripts();

    this.setState({
      isLoading: false,
      scripts,
    });
  }

  handleSearch = (event: SyntheticInputEvent<>): void => {
    this.setState({ searchQuery: event.target.value });
  };

  deleteScript = (script: APIScriptType) => {
    Modal.confirm({
      title: messages["script.delete"],
      onOk: async () => {
        this.setState({
          isLoading: true,
        });

        await deleteScript(script.id);
        this.setState({
          isLoading: false,
          scripts: this.state.scripts.filter(s => s.id !== script.id),
        });
      },
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container wide">
        <div style={{ marginTag: 20 }}>
          <div className="pull-right">
            <a href="/scripts/create">
              <Button icon="plus" style={marginRight} type="primary">
                Add Script
              </Button>
            </a>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
            />
          </div>
          <h3>Scripts</h3>
          <div className="clearfix" style={{ margin: "20px 0px" }} />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryOR(
                this.state.scripts,
                ["name", "id", "owner", "gist"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{ marginTop: 30, marginBotton: 30 }}
            >
              <Column
                title="ID"
                dataIndex="id"
                key="id"
                className="monospace-id"
                sorter={Utils.localeCompareBy("id")}
              />
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy("name")}
              />

              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy((scripts: APIScriptType) => scripts.owner.lastName)}
                render={owner => `${owner.firstName} ${owner.lastName}`}
              />
              <Column
                title="Gist URL"
                dataIndex="gist"
                key="gist"
                sorter={Utils.localeCompareBy("gist")}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, script: APIScriptType) => (
                  <span>
                    <a href={`/scripts/${script.id}/edit`}>
                      <Icon type="edit" />Edit
                    </a>
                    <br />
                    <a href="#" onClick={_.partial(this.deleteScript, script)}>
                      <Icon type="delete" />Delete
                    </a>
                  </span>
                )}
              />
            </Table>
          </Spin>
        </div>
      </div>
    );
  }
}

export default ScriptListView;
