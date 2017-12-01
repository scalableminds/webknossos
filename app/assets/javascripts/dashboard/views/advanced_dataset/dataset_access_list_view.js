// @flow
/* eslint-disable jsx-a11y/href-no-hash */

import * as React from "react";
import TemplateHelpers from "libs/template_helpers";
import { getDatasetAccessList } from "admin/admin_rest_api";
import type { APIDatasetType, APIUserType } from "admin/api_flow_types";
import { Spin, Tag } from "antd";

type Props = {
  dataset: APIDatasetType,
};

type State = {
  datasetUsers: Array<APIUserType>,
  isLoading: boolean,
};

export default class DatasetAccessListView extends React.PureComponent<Props, State> {
  state = {
    datasetUsers: [],
    isLoading: false,
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData(): Promise<void> {
    this.setState({ isLoading: true });
    const datasetUsers = await getDatasetAccessList(this.props.dataset.name);

    this.setState({
      datasetUsers,
      isLoading: false,
    });
  }

  renderTable() {
    return (
      <div>
        <h5>Users with Access Rights</h5>
        <ul>
          {this.state.datasetUsers.map(user => (
            <li key={user.id}>
              <div style={{ width: 150, display: "inline-block" }}>
                {user.firstName} {user.lastName}
              </div>
              {user.teams.map(team => (
                <Tag color={TemplateHelpers.stringToColor(team.team)} key={team.team}>
                  {team.team}
                </Tag>
              ))}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  render() {
    <Spin size="large" spinning={this.state.isLoading}>
      {this.renderTable()}
    </Spin>;
  }
}
