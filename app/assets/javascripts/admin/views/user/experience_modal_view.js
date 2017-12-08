// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Input, Icon } from "antd";
import update from "immutability-helper";
import { updateUser } from "admin/admin_rest_api";
import type { APIUserType } from "admin/api_flow_types";

type Props = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUserIds: Array<string>,
  users: Array<APIUserType>,
};

type State = {
  domain: ?string,
  level: ?string,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  state = {
    domain: null,
    level: null,
  };

  increaseExperience = (): void => {
    this.setExperience(null, true);
  };

  setExperience = (event: ?SyntheticInputEvent<>, shouldAddValue: boolean = false): void => {
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
  };

  deleteExperience = () => {
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
  };

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
          domain: null,
          level: null,
        });
        this.props.onChange(newUsers);
      },
      () => {
        // do nothing and keep modal open
      },
    );
  }

  render() {
    if (!this.props.visible) {
      return null;
    }

    const { domain, level } = this.state;
    const isDomainValid = _.isString(domain) && domain !== "";
    const isLevelValid = !Number.isNaN(parseInt(level));

    return (
      <Modal
        title="Change Experiences"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        footer={
          <div>
            <Button
              type="primary"
              onClick={this.increaseExperience}
              disabled={!(isDomainValid && isLevelValid)}
            >
              Increase Experience
            </Button>
            <Button
              type="primary"
              onClick={this.setExperience}
              disabled={!(isDomainValid && isLevelValid)}
            >
              Set Experience
            </Button>
            <Button type="primary" onClick={this.deleteExperience} disabled={!isDomainValid}>
              Delete Experience
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Input
          value={this.state.domain}
          onChange={event => this.setState({ domain: event.target.value })}
          prefix={<Icon type="tags" style={{ fontSize: 13 }} />}
          style={{ marginBottom: 10 }}
          placeholder="Domain"
        />
        <Input
          value={this.state.level}
          onChange={event => this.setState({ level: event.target.value })}
          prefix={<Icon type="filter" style={{ fontSize: 13 }} />}
          placeholder="Level"
        />
      </Modal>
    );
  }
}

export default ExperienceModalView;
