import { Link } from "react-router-dom";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import { Table, Spin, Button, Input, Modal } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import type { APIScript, APIUser } from "types/api_flow_types";
import { getScripts, deleteScript } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import LinkButton from "components/link_button";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import messages from "messages";
const { Column } = Table;
const { Search } = Input;
const typeHint: APIScript[] = [];
type Props = {};
type State = {
  isLoading: boolean;
  scripts: Array<APIScript>;
  searchQuery: string;
};
const persistence = new Persistence<Pick<State, "searchQuery">>(
  {
    searchQuery: PropTypes.string,
  },
  "scriptList",
);

class ScriptListView extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: true,
    scripts: [],
    searchQuery: "",
  };

  componentDidMount() {
    // @ts-ignore
    this.setState(persistence.load());
    this.fetchData();
  }

  componentDidUpdate() {
    persistence.persist(this.state);
  }

  async fetchData(): Promise<void> {
    const scripts = await getScripts();
    this.setState({
      isLoading: false,
      scripts,
    });
  }

  handleSearch = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.setState({
      searchQuery: event.target.value,
    });
  };

  deleteScript = (script: APIScript) => {
    Modal.confirm({
      title: messages["script.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteScript(script.id);
          this.setState((prevState) => ({
            scripts: prevState.scripts.filter((s) => s.id !== script.id),
          }));
        } catch (error) {
          handleGenericError(error as Error);
        } finally {
          this.setState({
            isLoading: false,
          });
        }
      },
    });
  };

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

  render() {
    const marginRight = {
      marginRight: 20,
    };
    return (
      <div className="container">
        <div>
          <div className="pull-right">
            <Link to="/scripts/create">
              <Button icon={<PlusOutlined />} style={marginRight} type="primary">
                Add Script
              </Button>
            </Link>
            <Search
              style={{
                width: 200,
              }}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>Scripts</h3>
          <div
            className="clearfix"
            style={{
              margin: "20px 0px",
            }}
          />

          <Spin spinning={this.state.isLoading} size="large">
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.scripts,
                ["name", "id", "owner", "gist"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{
                marginTop: 30,
                marginBottom: 30,
              }}
              locale={{
                emptyText: this.renderPlaceholder(),
              }}
              scroll={{
                x: "max-content",
              }}
              className="large-table"
            >
              <Column
                title="ID"
                dataIndex="id"
                key="id"
                className="monospace-id"
                sorter={Utils.localeCompareBy(typeHint, (script) => script.id)}
                width={150}
              />
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, (script) => script.name)}
                width={250}
              />

              <Column
                title="Owner"
                dataIndex="owner"
                key="owner"
                sorter={Utils.localeCompareBy(typeHint, (script) => script.owner.lastName)}
                render={(owner: APIUser) => `${owner.firstName} ${owner.lastName}`}
              />
              <Column
                title="Gist URL"
                dataIndex="gist"
                key="gist"
                sorter={Utils.localeCompareBy(typeHint, (script) => script.gist)}
                render={(gist: string) => (
                  <a href={gist} target="_blank" rel="noopener noreferrer">
                    {gist}
                  </a>
                )}
              />
              <Column
                title="Action"
                key="actions"
                fixed="right"
                width={180}
                render={(__, script: APIScript) => (
                  <span>
                    <Link to={`/scripts/${script.id}/edit`}>
                      <EditOutlined className="icon-margin-right" />
                      Edit
                    </Link>
                    <br />
                    <LinkButton onClick={_.partial(this.deleteScript, script)}>
                      <DeleteOutlined className="icon-margin-right" />
                      Delete
                    </LinkButton>
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
