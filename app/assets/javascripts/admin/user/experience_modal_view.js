// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber } from "antd";
import Toast from "libs/toast";
import { updateUser } from "admin/admin_rest_api";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import SelectExperienceDomainView from "components/select_experience_domain_view";

const { Column } = Table;

type SharedTableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
};

type ChangingTableEntry = {
  domain: string,
  value: number,
  removed: boolean,
};

type Props = {
  onChange: Function,
  onCancel: Function,
  visible: boolean,
  selectedUsers: Array<APIUserType>,
};

type State = {
  sharedExperiencesEntries: Array<SharedTableEntry>,
  changeEntries: Array<ChangingTableEntry>,
  enteredExperience: Array<string>,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      sharedExperiencesEntries: this.loadTableEntries(),
      enteredExperience: [],
      changeEntries: [],
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({
        sharedExperiencesEntries: this.loadTableEntries(),
        enteredExperience: [],
        changeEntries: [],
      });
    }
  }

  loadTableEntries = (): Array<SharedTableEntry> => {
    let lowestCountOfDomains = 0;
    const selectedUsers = this.props.selectedUsers;
    for (let i = 0; i < selectedUsers.length; i++) {
      lowestCountOfDomains =
        Object.keys(selectedUsers[i].experiences).length <
        Object.keys(selectedUsers[lowestCountOfDomains].experiences).length
          ? i
          : lowestCountOfDomains;
    }
    // search for all domains all users have
    const domains = Object.keys(selectedUsers[lowestCountOfDomains].experiences);
    const sharedDomains = [];
    domains.forEach(domain => {
      let isShared = true;
      selectedUsers.forEach(user => {
        if (!isShared) return;
        if (!(domain in user.experiences)) isShared = false;
      });
      if (isShared) sharedDomains.push(domain);
    });
    // create entries
    const entries = sharedDomains.map(domain => {
      let lowestValue = selectedUsers[0].experiences[domain];
      let highestValue = selectedUsers[0].experiences[domain];
      selectedUsers.forEach(user => {
        lowestValue =
          user.experiences[domain] < lowestValue ? user.experiences[domain] : lowestValue;
        highestValue =
          user.experiences[domain] > highestValue ? user.experiences[domain] : highestValue;
      });
      return {
        domain,
        value: lowestValue === highestValue ? lowestValue : 0,
        removed: false,
        lowestValue,
        highestValue,
      };
    });
    // sort entries
    return _.sortBy(entries, entry => entry.domain);
  };

  increaseUsersExperiences = async () => {
    const newUserPromises = this.props.selectedUsers.map(user => {
      const newUser = { ...user };
      this.state.changeEntries.forEach(entry => {
        if (entry.removed) return;
        const newExperiences = { ...newUser.experiences };
        if (entry.domain in newExperiences) {
          newExperiences[entry.domain] += entry.value;
        } else {
          newExperiences[entry.domain] = entry.value;
        }
        if (newExperiences[entry.domain] < 1) {
          Toast.warning(
            `User ${user.lastName}, ${user.firstName} would have a negative Experience at ${
              entry.domain
            }. Fallback to value 1 is executed.`,
          );
          newExperiences[entry.domain] = 1;
        }
        newUser.experiences = newExperiences;
      });
      return this.sendUserToServer(newUser, user);
    });
    this.closeModal(newUserPromises);
  };

  setUsersExperiences = async () => {
    const newUserPromises = this.props.selectedUsers.map(user => {
      const newUser = { ...user };
      this.state.changeEntries.forEach(entry => {
        if (entry.removed) return;
        const newExperiences = { ...newUser.experiences };
        newExperiences[entry.domain] = entry.value;
        newUser.experiences = newExperiences;
      });
      return this.sendUserToServer(newUser, user);
    });
    this.closeModal(newUserPromises);
  };

  removeUsersExperiences = async () => {
    const newUserPromises = this.props.selectedUsers.map(user => {
      const newUser = { ...user };
      this.state.changeEntries.forEach(entry => {
        if (entry.removed) return;
        if (entry.domain in newUser.experiences) {
          delete user.experiences[entry.domain];
        }
      });
      return this.sendUserToServer(newUser, user);
    });
    this.closeModal(newUserPromises);
  };

  sendUserToServer(newUser: APIUserType, oldUser: APIUserType): Promise<APIUserType> {
    return updateUser(newUser).then(() => Promise.resolve(newUser), () => Promise.reject(oldUser));
  }

  closeModal(usersPromises: Array<Promise<APIUserType>>): void {
    Promise.all(usersPromises).then(
      newUsers => {
        this.setState({
          sharedExperiencesEntries: [],
          changeEntries: [],
          enteredExperience: [],
        });
        this.props.onChange(newUsers);
      },
      () => {
        Toast.error("At least one update could not be performed");
      },
    );
  }

  validateEntry(entry: ChangingTableEntry): boolean {
    return entry.removed || entry.domain.length > 2;
  }

  validateDomainAndValues(tableData: Array<ChangingTableEntry>) {
    if (tableData.length <= 0) return false;
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid) isValid = this.validateEntry(entry);
    });
    return isValid;
  }

  increaseValueOfEntrysBy = (index: number, val: number) => {
    this.setState(prevState => ({
      changeEntries: prevState.changeEntries.map((entry, currentIndex) => {
        if (currentIndex === index) {
          return {
            ...entry,
            value: entry.value + val,
          };
        } else {
          return entry;
        }
      }),
    }));
  };

  setValueOfEntry = (index: number, value: number) => {
    this.setState(prevState => ({
      changeEntries: prevState.changeEntries.map((entry, currentIndex) => {
        if (currentIndex === index) {
          return {
            ...entry,
            value,
          };
        } else {
          return entry;
        }
      }),
    }));
  };

  setRemoveOfEntryTo = (index: number, removed: boolean) => {
    this.setState(prevState => ({
      changeEntries: prevState.changeEntries.map((entry, currentIndex) => {
        if (currentIndex === index) {
          return {
            ...entry,
            removed,
          };
        } else {
          return entry;
        }
      }),
    }));
  };

  handleExperienceSelected = (domain: string) => {
    if (domain.length < 3) {
      Toast.warning("Experience Domains need at least 3 characters.");
      return;
    }
    if (!this.state.changeEntries.find(entry => entry.domain === domain)) {
      this.setState(prevState => ({
        enteredExperience: _.concat(prevState.enteredExperience, domain),
      }));
    }
  };

  handleExperienceDeselected = (domain: string) => {
    this.setState(prevState => ({
      enteredExperience: prevState.enteredExperience.filter(
        currentDomain => currentDomain !== domain,
      ),
    }));
  };

  addEnteredExperiences = (removed: boolean) => {
    const newExperiences = this.state.enteredExperience.map(entry => ({
      domain: entry,
      value: 1,
      removed,
    }));
    this.setState(prevState => ({
      changeEntries: _.sortBy(
        _.concat(prevState.changeEntries, newExperiences),
        entry => entry.domain,
      ),
      enteredExperience: [],
    }));
  };

  getDomainsOfTable = (): ExperienceDomainListType =>
    this.state.changeEntries.map(entry => entry.domain);

  hasEntriesWithNegativeValue = (): boolean =>
    this.state.changeEntries.find(entry => entry.value < 1) !== undefined;

  render() {
    if (!this.props.visible) {
      return null;
    }
    const sharedExperiencesEntries = this.state.sharedExperiencesEntries;
    const changeEntries = this.state.changeEntries;
    const isValid = this.validateDomainAndValues(changeEntries);
    const hasNegativeEntries = this.hasEntriesWithNegativeValue();
    return (
      <Modal
        className="experience-change-modal"
        title="Change Experiences of Multiple Users"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        width={800}
        footer={
          <div>
            <Button
              className="confirm-button"
              onClick={this.increaseUsersExperiences}
              disabled={!isValid}
            >
              {"Increase Users' Experiences"}
            </Button>
            <Button
              className="confirm-button"
              onClick={this.setUsersExperiences}
              disabled={!isValid || hasNegativeEntries}
            >
              {"Set Users' Experiences"}
            </Button>
            <Button
              className="confirm-button"
              onClick={this.removeUsersExperiences}
              disabled={!isValid || hasNegativeEntries}
            >
              {"Remove Users' Experiences"}
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Table
          title={() => "Shared Experience Domains"}
          size="small"
          dataSource={sharedExperiencesEntries}
          rowKey="domain"
          pagination={false}
          scroll={{ y: 200 }}
          className="user-experience-table"
        >
          <Column title="Experience Domain" key="domain" dataIndex="domain" width="50%" />
          <Column
            title="Experience Value"
            key="value"
            width="50%"
            render={record =>
              record.highestValue === record.lowestValue
                ? record.value
                : `varying from ${record.lowestValue} to ${record.highestValue}`
            }
          />
        </Table>
        <Table
          title={() => "Changes"}
          size="small"
          dataSource={changeEntries}
          rowKey="domain"
          pagination={false}
          scroll={changeEntries.length > 0 ? { y: 200 } : {}}
          className="user-experience-table"
        >
          <Column
            title="Experience Domain"
            key="domain"
            width="35%"
            render={record =>
              record.removed ? <div className="disabled">{record.domain}</div> : record.domain
            }
          />
          <Column
            title="Experience Value"
            key="value"
            width="45%"
            render={record => {
              const index = changeEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  <Icon
                    type="minus"
                    className={
                      record.removed
                        ? "clickable-icon disabled-icon disabled-clickable-icon"
                        : "clickable-icon active-icon hoverable-icon"
                    }
                    onClick={record.removed ? null : () => this.increaseValueOfEntrysBy(index, -1)}
                  />
                  <InputNumber
                    disabled={record.removed}
                    value={changeEntries[index].value}
                    onChange={value => this.setValueOfEntry(index, value)}
                  />
                  <Icon
                    type="plus"
                    className={
                      record.removed
                        ? "clickable-icon disabled-icon disabled-clickable-icon"
                        : "clickable-icon active-icon hoverable-icon"
                    }
                    style={{ marginLeft: 5 }}
                    onClick={record.removed ? null : () => this.increaseValueOfEntrysBy(index, 1)}
                  />
                </span>
              );
            }}
          />
          <Column
            title="Delete Entry"
            key="removed"
            width="20%"
            render={record => {
              const index = changeEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  {record.removed ? (
                    <Tooltip placement="top" title="Undo">
                      <Icon
                        type="close-circle-o"
                        onClick={() => this.setRemoveOfEntryTo(index, false)}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip placement="top" title="Delete this Domain">
                      <Icon type="delete" onClick={() => this.setRemoveOfEntryTo(index, true)} />
                    </Tooltip>
                  )}
                </span>
              );
            }}
          />
        </Table>
        <span>
          <SelectExperienceDomainView
            disabled={false}
            value={this.state.enteredExperience}
            onSelect={this.handleExperienceSelected}
            onDeselect={this.handleExperienceDeselected}
            alreadyUsedDomains={this.getDomainsOfTable()}
          />
          {this.state.enteredExperience.length > 0 ? (
            <Tooltip placement="top" title="Clear Input">
              <Icon
                type="close-circle"
                className="clear-input-icon hoverable-icon clickable-icon"
                onClick={() => this.setState({ enteredExperience: [] })}
              />
            </Tooltip>
          ) : (
            <Icon type="close-circle" className="clear-input-icon invisible-icon" />
          )}
          <Button
            className="add-button"
            disabled={!this.state.enteredExperience || this.state.enteredExperience.length <= 0}
            onClick={() => this.addEnteredExperiences(false)}
          >
            {this.state.enteredExperience.length === 0 ? "Add Experience" : "Add Experiences"}
          </Button>
          <Button
            className="add-button"
            disabled={!this.state.enteredExperience || this.state.enteredExperience.length <= 0}
            onClick={() => this.addEnteredExperiences(true)}
          >
            {this.state.enteredExperience.length === 0 ? "Remove Experience" : "Remove Experiences"}
          </Button>
        </span>
      </Modal>
    );
  }
}

export default ExperienceModalView;
