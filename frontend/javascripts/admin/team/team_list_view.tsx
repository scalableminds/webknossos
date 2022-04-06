// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module '@sca... Remove this comment to see the full error message
import { PropTypes } from "@scalableminds/prop-types";
import type { RouteComponentProps } from "react-router-dom";
import { withRouter } from "react-router-dom";
import { Table, Spin, Button, Input, Modal, Alert } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";
import type { APITeam } from "types/api_flow_types";
import { getEditableTeams, deleteTeam } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import LinkButton from "components/link_button";
import CreateTeamModal from "admin/team/create_team_modal_view";
import Persistence from "libs/persistence";
import * as Utils from "libs/utils";
import messages from "messages";
const { Column } = Table;
const { Search } = Input;
const typeHint: APITeam[] = [];
type Props = {
  history: RouteComponentProps["history"];
};
type State = {
  isLoading: boolean;
  teams: Array<APITeam>;
  searchQuery: string;
  isTeamCreationModalVisible: boolean;
};
const persistence: Persistence<State> = new Persistence(
  {
    searchQuery: PropTypes.string,
  },
  "teamList",
);

class TeamListView extends React.PureComponent<Props, State> {
  state = {
    isLoading: true,
    teams: [],
    searchQuery: "",
    isTeamCreationModalVisible: false,
  };

  componentDidMount() {
    this.setState(persistence.load(this.props.history));
    this.fetchData();
  }

  componentDidUpdate() {
    persistence.persist(this.props.history, this.state);
  }

  async fetchData(): Promise<void> {
    const teams = await getEditableTeams();
    this.setState({
      isLoading: false,
      teams,
    });
  }

  handleSearch = (event: React.SyntheticEvent): void => {
    this.setState({
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'value' does not exist on type 'EventTarg... Remove this comment to see the full error message
      searchQuery: event.target.value,
    });
  };

  deleteTeam = (team: APITeam) => {
    Modal.confirm({
      title: messages["team.delete"],
      onOk: async () => {
        try {
          this.setState({
            isLoading: true,
          });
          await deleteTeam(team.id);
          this.setState((prevState) => ({
            teams: prevState.teams.filter((t) => t.id !== team.id),
          }));
        } catch (error) {
          handleGenericError(error);
        } finally {
          this.setState({
            isLoading: false,
          });
        }
      },
    });
  };

  createTeam = (newTeam: APITeam) => {
    this.setState((prevState) => ({
      isTeamCreationModalVisible: false,
      teams: prevState.teams.concat([newTeam]),
    }));
  };

  renderPlaceholder() {
    const teamMessage = (
      <React.Fragment>
        {"You can "}
        <a
          onClick={() =>
            this.setState({
              isTeamCreationModalVisible: true,
            })
          }
        >
          add a team
        </a>
        {" to control access to specific datasets and manage which users can be assigned to tasks."}
      </React.Fragment>
    );
    return this.state.isLoading ? null : (
      <Alert message="Add more teams" description={teamMessage} type="info" showIcon />
    );
  }

  render() {
    const marginRight = {
      marginRight: 20,
    };
    return (
      <div className="container">
        <div
          style={{
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ marginTag: number; }' is not assignable to... Remove this comment to see the full error message
            marginTag: 20,
          }}
        >
          <div className="pull-right">
            <Button
              icon={<PlusOutlined />}
              style={marginRight}
              type="primary"
              onClick={() =>
                this.setState({
                  isTeamCreationModalVisible: true,
                })
              }
            >
              Add Team
            </Button>
            <Search
              style={{
                width: 200,
              }}
              onPressEnter={this.handleSearch}
              onChange={this.handleSearch}
              value={this.state.searchQuery}
            />
          </div>
          <h3>Teams</h3>
          <div
            className="clearfix"
            style={{
              margin: "20px 0px",
            }}
          />

          <Spin spinning={this.state.isLoading} size="large">
            {this.state.teams.length <= 1 ? this.renderPlaceholder() : null}
            <Table
              dataSource={Utils.filterWithSearchQueryAND(
                this.state.teams,
                ["name"],
                this.state.searchQuery,
              )}
              rowKey="id"
              pagination={{
                defaultPageSize: 50,
              }}
              style={{
                marginTop: 30,
                // @ts-expect-error ts-migrate(2322) FIXME: Type '{ marginTop: number; marginBotton: number; }... Remove this comment to see the full error message
                marginBotton: 30,
              }}
            >
              <Column
                title="Name"
                dataIndex="name"
                key="name"
                sorter={Utils.localeCompareBy(typeHint, (team) => team.name)}
              />
              <Column
                title="Action"
                key="actions"
                render={(__, script: APITeam) => (
                  <LinkButton onClick={_.partial(this.deleteTeam, script)}>
                    <DeleteOutlined />
                    Delete
                  </LinkButton>
                )}
              />
            </Table>
          </Spin>
          <CreateTeamModal
            // @ts-expect-error ts-migrate(2322) FIXME: Type '{ teams: never[]; isVisible: boolean; onOk: ... Remove this comment to see the full error message
            teams={this.state.teams}
            isVisible={this.state.isTeamCreationModalVisible}
            onOk={this.createTeam}
            onCancel={() =>
              this.setState({
                isTeamCreationModalVisible: false,
              })
            }
          />
        </div>
      </div>
    );
  }
}

export default withRouter<RouteComponentProps & Props, any>(TeamListView);
