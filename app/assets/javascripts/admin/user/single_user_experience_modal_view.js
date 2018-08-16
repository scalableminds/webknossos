// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Input, Icon, Tag, Table } from "antd";
import CustomValueInput from "components/custom_value_input";
import update from "immutability-helper";
import { updateUser } from "admin/admin_rest_api";
import type { APIUserType, ExperienceMapType } from "admin/api_flow_types";

const { Column } = Table;

type Props = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUser: APIUserType,
};

type State = {
  experiences: ExperienceMapType,
  // use an array to save change stuff and before commit change ask with another modal
};

class SingleUserExperienceModalView extends React.PureComponent<Props, State> {
  state = {
    experiences: this.props.selectedUser.experiences,
  };

  increaseExperience = (): void => {
    this.setExperience(null, true);
  };

  /* setExperience = (event: ?SyntheticInputEvent<>, shouldAddValue: boolean = false): void => {
    const { domain, level } = this.state;
    if (domain && level !== null) {
      const newUserPromises = this.props.users.map(user => {
        if (this.props.selectedUserIds.includes(user.id)) {
          let newExperienceLevel = parseInt(level);

          if (shouldAddValue && user.experiences[domain]) {
            newExperienceLevel = user.experiences[domain] + parseInt(level);
          }

          const newUser = update(user, {
            experiences: { [domain]: { $set: newExperienceLevel } },
          });

          return this.sendUserToServer(newUser, user);
        }
        return Promise.resolve(user);
      });

      this.closeModal(newUserPromises);
    }
  }; */

  /* deleteExperience = () => {
    if (this.state.domain) {
      const { domain } = this.state;
      const newUserPromises = this.props.users.map(user => {
        if (this.props.selectedUserIds.includes(user.id)) {
          const newExperiences = _.omit(user.experiences, domain);
          const newUser = update(user, {
            experiences: { $set: newExperiences },
          });

          return this.sendUserToServer(newUser, user);
        }
        return Promise.resolve(user);
      });

      this.closeModal(newUserPromises);
    }
  }; */

  /**
   * Save a user object to the server using an API call.
   * @param newUser - A modified user object intended to be saved.
   * @param oldUser - The original user object of `newUser`. Returned in case API call fails
   *
   */
  sendUserToServer(newUser: APIUserType, oldUser: APIUserType): Promise<APIUserType> {
    return updateUser(newUser).then(() => Promise.resolve(newUser), () => Promise.reject(oldUser));
  }

  closeModal(usersPromises: Array<Promise<APIUserType>>): void {
    Promise.all(usersPromises).then(
      newUsers => {
        this.setState({
          experiences: null,
        });
        this.props.onChange(newUsers);
      },
      () => {
        // do nothing and keep modal open
      },
    );
  }

  /* renderExperienceComponent(experienceDomain: string, experienceValue: int){
    return(<span>)

  } */

  validateDomainAndValues(tableData: []) {
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid && (entry.domain.length < 3 || entry.value < 1)) isValid = false;
    });
    return isValid;
  }

  render() {
    if (!this.props.visible) {
      return null;
    }

    const experiences = this.state.experiences;
    const tableData = [];
    _.map(experiences, (value, domain) => {
      tableData.push({ domain, value });
    });
    const isValid = this.validateDomainAndValues(tableData);
    const pagination = tableData > 10 ? { pageSize: 10 } : false;
    return (
      <Modal
        title={`Change Experiences of user ${this.props.selectedUser.lastName}, ${
          this.props.selectedUser.firstName
        }`}
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        width={600}
        footer={
          <div>
            <Button type="primary" onClick={this.increaseExperience} disabled={!isValid}>
              Update Experience
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        {/* _.map(this.props.selectedUser.experiences, (value, domain) => (
          // here -> edit to the suggested design so every existing domain's value can be changed or completely deleted
          <Tag key={`experience_${user.id}_${domain}`}>
            {domain} : {value}
          </Tag>
        )) */}
        <Table dataSource={tableData} rowKey="domain" pagination={pagination}>
          <Column title="Experience Domain" dataIndex="domain" key="domain" />
          <Column
            title="Experience Value"
            key="value"
            render={record => (
              <CustomValueInput
                increase={() => {
                  const exp = this.state.experiences;
                  exp[record.domain]++;
                  this.setState({ experiences: exp });
                }}
                decrease={() => {
                  const exp = this.state.experiences;
                  exp[record.domain]--;
                  this.setState({ experiences: exp });
                }}
                onChange={value => {
                  const exp = this.state.experiences;
                  exp[record.domain] = value;
                  this.setState({ experiences: exp });
                }}
                min={1}
                max={100}
                initialValue={this.state.experiences[record.domain]}
              />
            )}
          />
          <Column
            title="Delete Entry"
            key={record => record.domain.concat(record.value)}
            render={(record, index) => (
              <span>
                <Button>Trash</Button>
              </span>
            )}
          />
        </Table>
      </Modal>
    );
  }
}

export default SingleUserExperienceModalView;
