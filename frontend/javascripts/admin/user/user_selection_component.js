// @flow

import { Spin, Select } from "antd";
import * as React from "react";
import _ from "lodash";

import type { APIUser } from "types/api_flow_types";
import { getUsers } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";

type Props = {
  handleSelection: string => void,
};

type State = {
  isLoading: boolean,
  users: Array<APIUser>,
  currentUserIdValue: string,
};

class UserSelectionComponent extends React.PureComponent<Props, State> {
  state = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    try {
      this.setState({ isLoading: true });
      const users = await getUsers();
      const activeUsers = users.filter(u => u.isActive);
      const sortedUsers = _.sortBy(activeUsers, "lastName");
      this.setState({
        users: sortedUsers,
      });
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.setState({ isLoading: false });
    }
  }

  handleSelectChange = (userId: string) => {
    this.setState({ currentUserIdValue: userId });
    this.props.handleSelection(userId);
  };

  render() {
    return this.state.isLoading ? (
      <div className="text-center">
        <Spin size="large" />
      </div>
    ) : (
      <Select
        showSearch
        placeholder="Select a New User"
        value={this.state.currentUserIdValue}
        onChange={this.handleSelectChange}
        optionFilterProp="children"
        style={{ width: "100%" }}
        filterOption={(input, option) =>
          option.label.toLowerCase().indexOf(input.toLowerCase()) >= 0
        }
        options={this.state.users.map(user => ({
          value: user.id,
          label: `${user.lastName}, ${user.firstName} (${user.email})`,
        }))}
      />
    );
  }
}

export default UserSelectionComponent;
