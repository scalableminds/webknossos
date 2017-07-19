import _ from "lodash";
import React from "react";
import { Modal, Button, Input, Icon } from "antd";
import Request from "libs/request";

class ExperienceModalView extends React.PureComponent {

  props: {
    onChange: Function,
    onCancel: Function,
    visible: boolean,
    selectedUserIds: Array<string>,
    users: Array<APIUserType>,
  }

  state = {
    domain: null,
    level: null,
  }

  increaseExperience = (): void => {
    this.setExperience(null, true);
  }

  setExperience = (event, shouldAddValue: boolean = false): void =>{
    const { domain, level } = this.state;
    if (domain && level) {

      const newUsers = this.props.users.map((user) => {
        if (this.props.selectedUserIds.includes(user.id)) {

          if (shouldAddValue) {
            if (user.experiences[domain]) {
              user.experiences[domain] += parseInt(level);
            } else {
              user.experiences[domain] = parseInt(level);
            }
          } else {
            user.experiences[domain] = parseInt(level);
          }

          const url = `/api/users/${user.id}`;
          Request.sendJSONReceiveJSON(url, {
            data: user
          });
        }

        return user
      });

      this.setState({
        domain: null,
        level: null,
      });

      this.props.onChange(newUsers);
    }
  }

  deleteExperience = () => {
    if (this.state.domain) {
      const newUsers = this.props.users.map((user) => {
        if (this.props.selectedUserIds.includes(user.id)) {
          delete user.experiences[this.state.domain]
        }
        return user
      });

      this.setState({
        domain: null,
        level: null,
      });

      this.props.onChange(newUsers);
    }
  }

  render() {
    const { domain, level } = this.state;
    const isDomainValid = _.isString(domain) && domain !== "";
    const isLevelValid = _.isNumber(parseInt(level)) && !isNaN(parseInt(level));

    return <Modal
      title="Change Experiences"
      visible={this.props.visible}
      footer={
        <div>
          <Button
            type="primary"
            onClick={this.increaseExperience}
            disabled={!(isDomainValid && isLevelValid)}
            >Increase Experience
          </Button>
          <Button
            type="primary"
            onClick={this.setExperience}
            disabled={!(isDomainValid && isLevelValid)}
            >Set Experience
          </Button>
          <Button
            type="primary"
            onClick={this.deleteExperience}
            disabled={!isDomainValid}
            >Delete Experience
          </Button>
          <Button onClick={() => this.props.onCancel() }>Cancel</Button>
        </div>
      }
    >
      <Input
        value={this.state.domain}
        onChange={(event) => this.setState({domain: event.target.value}) }
        prefix={<Icon type="tags" style={{ fontSize: 13 }} />}
        placeholder="Domain" />
      <Input
        value={this.state.level}
        onChange={(event) => this.setState({level: event.target.value}) }
        prefix={<Icon type="filter" style={{ fontSize: 13 }} />}
        placeholder="Level" />
    </Modal>
  }
}

export default ExperienceModalView;
