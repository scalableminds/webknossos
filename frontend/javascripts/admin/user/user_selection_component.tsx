import { getUsers } from "admin/admin_rest_api";
import { Select, Spin } from "antd";
import { handleGenericError } from "libs/error_handling";
import _ from "lodash";
import * as React from "react";
import type { APIUser } from "types/api_flow_types";
type Props = {
  handleSelection: (arg0: string) => void;
};
type State = {
  isLoading: boolean;
  users: Array<APIUser>;
  currentUserIdValue: string;
};

class UserSelectionComponent extends React.PureComponent<Props, State> {
  state: State = {
    isLoading: false,
    users: [],
    currentUserIdValue: "",
  };

  componentDidMount() {
    this.fetchData();
  }

  async fetchData() {
    try {
      this.setState({
        isLoading: true,
      });
      const users = await getUsers();
      const activeUsers = users.filter((u) => u.isActive);

      const sortedUsers = _.sortBy(activeUsers, "lastName");

      this.setState({
        users: sortedUsers,
      });
    } catch (error) {
      handleGenericError(error as Error);
    } finally {
      this.setState({
        isLoading: false,
      });
    }
  }

  handleSelectChange = (userId: string) => {
    this.setState({
      currentUserIdValue: userId,
    });
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
        optionFilterProp="label"
        style={{
          width: "100%",
        }}
        filterOption={(input, option) =>
          // @ts-expect-error ts-migrate(2532) FIXME: Object is possibly 'undefined'.
          option.label.toLowerCase().indexOf(input.toLowerCase()) >= 0
        }
        options={this.state.users.map((user) => ({
          value: user.id,
          label: `${user.lastName}, ${user.firstName} (${user.email})`,
        }))}
      />
    );
  }
}

export default UserSelectionComponent;
