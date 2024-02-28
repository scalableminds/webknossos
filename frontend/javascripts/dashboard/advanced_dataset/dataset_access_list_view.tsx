import { getDatasetAccessList } from "admin/admin_rest_api";
import { Spin, Tag } from "antd";
import { handleGenericError } from "libs/error_handling";
import { stringToColor } from "libs/format_utils";
import * as React from "react";
import type { APIDataset, APIUser } from "types/api_flow_types";

type Props = {
  dataset: APIDataset;
};
type State = {
  datasetUsers: APIUser[];
  isLoading: boolean;
};
export default class DatasetAccessListView extends React.PureComponent<Props, State> {
  state: State = {
    datasetUsers: [],
    isLoading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    try {
      this.setState({
        isLoading: true,
      });
      const datasetUsers = await getDatasetAccessList(this.props.dataset);
      this.setState({
        datasetUsers,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  }

  renderUserTags(user: APIUser): Array<React.ReactNode> {
    if (user.isAdmin) {
      return [
        <Tag key={`team_role_${user.id}`} color="red">
          Admin
        </Tag>,
      ];
    } else {
      const managerTags = user.isDatasetManager
        ? [
            <Tag key={`dataset_manager_${user.id}`} color="geekblue">
              Dataset Manager
            </Tag>,
          ]
        : [];
      const teamTags = user.teams.map((team) => (
        <Tag color={stringToColor(team.name)} key={`${user.id}-${team.id}`}>
          {team.name}
        </Tag>
      ));
      return managerTags.concat(teamTags);
    }
  }

  renderTable() {
    return (
      <div>
        <ul>
          {this.state.datasetUsers.map((user: APIUser) => (
            <li key={user.id}>
              <div
                style={{
                  width: 150,
                  display: "inline-block",
                }}
              >
                {user.firstName} {user.lastName}
              </div>
              {this.renderUserTags(user)}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  render() {
    return (
      <Spin size="large" spinning={this.state.isLoading}>
        {this.renderTable()}
      </Spin>
    );
  }
}
