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
      <table className="table table-condensed table-nohead table-hover">
        <thead>
          <tr>
            <th>Users with Access Rights</th>
          </tr>
        </thead>
        <tbody>
          {this.state.datasetUsers.map(user => (
            <tr key={user.id}>
              <td>
                {user.firstName} {user.lastName}
              </td>
              <td>
                {user.teams.map(team => (
                  <Tag color={TemplateHelpers.stringToColor(team.team)} key={team.team}>
                    {team.team}
                  </Tag>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  render() {
    return this.state.isLoading ? (
      <div className="text-center">
        <Spin size="large" />
      </div>
    ) : (
      this.renderTable()
    );
  }
}
