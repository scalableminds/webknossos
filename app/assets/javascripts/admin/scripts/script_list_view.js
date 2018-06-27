// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import _ from "lodash";
import * as React from "react";
import { Link, withRouter } from "react-router-dom";
import { Table, Icon, Spin, Button, Input, Modal } from "antd";
import Utils from "libs/utils";
import messages from "messages";
import { getScripts, deleteScript } from "admin/admin_rest_api";
import Persistence from "libs/persistence";
import { PropTypes } from "@scalableminds/prop-types";
import type { APIScriptType, APIUserType } from "admin/api_flow_types";
import type { RouterHistory } from "react-router-dom";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;
const { Search } = Input;

const typeHint: APIScriptType[] = [];

type Props = {
  history: RouterHistory,
};

type State = {
  isLoading: boolean,
  scripts: Array<APIScriptType>,
  searchQuery: string,
};

const persistence: Persistence<State> = new Persistence(
  { searchQuery: PropTypes.string },
  "scriptList",
);

class ScriptListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    scripts: [],
    searchQuery: "",
  };

  componentWillMount() {
    this.setState(persistence.load(this.props.history));
  }

  componentDidMount() {
    this.fetchData();
  }

  componentWillUpdate(nextProps, nextState) {
    persistence.persist(this.props.history, nextState);
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
        try {
          this.setState({
            isLoading: true,
          });

          await deleteScript(script.id);
          this.setState({
            scripts: this.state.scripts.filter(s => s.id !== script.id),
          });
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({ isLoading: false });
        }
      },
    });
  };

  render() {
    const marginRight = { marginRight: 20 };

    return (
      <div className="container">
        <div>
          <div className="pull-right">
            <Link to="/scripts/create">
              <Button icon="plus" style={marginRight} type="primary">
                Add Script
              </Button>
            </Link>
            <Search
              style={{ width: 200 }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
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
                sorter={Utils.localeCompareBy(typeHint, "id")}
              />
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, "name")}
              />

              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, scripts => scripts.owner.lastName)}
                render={(owner: APIUserType) => `${owner.firstName} ${owner.lastName}`}
              />
              <Column
                title="Gist URL"
                dataIndex="gist"
                key="gist"
                sorter={Utils.localeCompareBy(typeHint, "gist")}
                render={(gist: string) => (
                  <a href={gist} target="_blank" rel="noopener noreferrer">
                    {gist}
                  </a>
                )}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, script: APIScriptType) => (
                  <span>
                    <Link to={`/scripts/${script.id}/edit`}>
                      <Icon type="edit" />Edit
                    </Link>
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

export default withRouter(ScriptListView);
