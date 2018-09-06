// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber } from "antd";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { updateUser } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import SelectExperienceDomain from "components/select_experience_domain";

const { Column } = Table;

export type EditTableEntry = {
  domain: string,
  value: number,
};

type Props = {
  onChange: (Array<APIUserType>) => void,
  onCancel: () => void,
  visible: boolean,
  selectedUsers: Array<APIUserType>,
};

type State = {
  sharedExperiencesEntries: ?Array<SharedTableEntry>,
  changeEntries: Array<EditTableEntry>,
  enteredExperiences: Array<string>,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      sharedExperiencesEntries: this.loadSharedTableEntries(props.selectedUsers),
      enteredExperiences: [],
      changeEntries: this.loadChangeTableEntries(props.selectedUsers),
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({
        sharedExperiencesEntries: this.loadSharedTableEntries(nextProps.selectedUsers),
        enteredExperiences: [],
        changeEntries: this.loadChangeTableEntries(nextProps.selectedUsers),
      });
    }
  }

  loadSharedTableEntries = (users: Array<APIUserType>): ?Array<SharedTableEntry> => {
    if (users.length > 1) {
      let lowestCountOfDomains = 0;
      for (let i = 0; i < users.length; i++) {
        lowestCountOfDomains =
          Object.keys(users[i].experiences).length <
          Object.keys(users[lowestCountOfDomains].experiences).length
            ? i
            : lowestCountOfDomains;
      }
      // search for all domains all users have
      const domains = Object.keys(users[lowestCountOfDomains].experiences);
      const sharedDomains = [];
      domains.forEach(domain => {
        let isShared = true;
        users.forEach(user => {
          if (!isShared) return;
          if (!(domain in user.experiences)) isShared = false;
        });
        if (isShared) sharedDomains.push(domain);
      });
      // create entries
      const entries = sharedDomains.map(domain => {
        let lowestValue = users[0].experiences[domain];
        let highestValue = users[0].experiences[domain];
        users.forEach(user => {
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
      return entries.sort(
        Utils.localeCompareBy(([]: Array<SharedTableEntry>), entry => entry.domain.toLowerCase()),
      );
    }
    return null;
  };

  loadChangeTableEntries = (users: Array<APIUserType>): Array<EditTableEntry> =>
    users.length === 1
      ? _.map(users[0].experiences, (value, domain) => ({
          domain,
          value,
          removed: false,
        })).sort(
          Utils.localeCompareBy(([]: Array<EditTableEntry>), entry => entry.domain.toLowerCase()),
        )
      : [];

  updateMultipleUsersExperiences = async () => {
    const newUserPromises = this.props.selectedUsers.map(user => {
      const newExperiences = { ...user.experiences };
      this.state.changeEntries.forEach(entry => {
        if (entry.removed) {
          delete newExperiences[entry.domain];
        } else {
          newExperiences[entry.domain] = entry.value;
        }
      });
      const newUser = { ...user, experiences: newExperiences };
      return this.sendUserToServer(newUser, user);
    });
    this.resolvePromisesAndCloseModal(newUserPromises);
  };

  updateSingleUsersExperiences = async () => {
    const user = this.props.selectedUsers[0];
    if (!user) {
      return;
    }
    const newExperiences = { ...user.experiences };
    this.state.changeEntries.forEach(entry => {
      if (entry.removed) {
        delete newExperiences[entry.domain];
      } else {
        newExperiences[entry.domain] = entry.value;
      }
    });
    const newUser = { ...user, experiences: newExperiences };
    try {
      const returnedUser = await this.sendUserToServer(newUser, user);
      const updatedUser = [returnedUser];
      this.props.onChange(updatedUser);
    } catch (error) {
      handleGenericError(error);
    }
  };

  sendUserToServer(newUser: APIUserType, oldUser: APIUserType): Promise<APIUserType> {
    return updateUser(newUser).then(() => Promise.resolve(newUser), () => Promise.reject(oldUser));
  }

  resolvePromisesAndCloseModal(usersPromises: Array<Promise<APIUserType>>): void {
    Promise.all(usersPromises).then(
      newUsers => {
        this.setState({
          sharedExperiencesEntries: [],
          changeEntries: [],
          enteredExperiences: [],
        });
        this.props.onChange(newUsers);
      },
      error => {
        handleGenericError(error);
      },
    );
  }

  validateEntry(entry: EditTableEntry): boolean {
    return entry.removed || (entry.domain.length > 2 && entry.value > 0);
  }

  validateDomainAndValues(tableData: Array<EditTableEntry>) {
    if (tableData.length <= 0) return false;
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid) isValid = this.validateEntry(entry);
    });
    return isValid;
  }

  recordModifiedAndExistedBefore = (record: EditTableEntry): boolean => {
    if (this.props.selectedUsers.length === 1)
      return (
        record.value !== this.props.selectedUsers[0].experiences[record.domain] &&
        record.domain in this.props.selectedUsers[0].experiences
      );
    else return false;
  };

  setValueOfEntry = (index: number, value: number) => {
    if (value > 0) {
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
    }
  };

  revertChangesOfEntry = (index: number) => {
    if (this.props.selectedUsers.length === 1) {
      this.setState(prevState => ({
        changeEntries: prevState.changeEntries.map((entry, currentIndex) => {
          if (currentIndex === index) {
            return {
              ...entry,
              value: this.props.selectedUsers[0].experiences[entry.domain],
            };
          } else {
            return entry;
          }
        }),
      }));
    }
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

  removeEntryFromTable = (index: number) => {
    this.setState(prevState => ({
      changeEntries: prevState.changeEntries.filter(
        entry => entry.domain !== prevState.changeEntries[index].domain,
      ),
    }));
  };

  handleExperienceSelected = (domain: string) => {
    if (domain.length < 3) {
      Toast.warning("Experience Domains need at least 3 characters.");
      return;
    }
    if (!this.state.changeEntries.find(entry => entry.domain === domain)) {
      this.setState(prevState => ({
        enteredExperiences: _.concat(prevState.enteredExperiences, domain),
      }));
    }
  };

  handleExperienceDeselected = (domain: string) => {
    this.setState(prevState => ({
      enteredExperiences: prevState.enteredExperiences.filter(
        currentDomain => currentDomain !== domain,
      ),
    }));
  };

  addEnteredExperiences = (removed: boolean) => {
    const newExperiences = this.state.enteredExperiences.map(entry => {
      if (
        this.state.sharedExperiencesEntries &&
        this.state.sharedExperiencesEntries.filter(experience => experience.domain === entry)
          .length <= 0
      ) {
        Toast.warning(
          "The experience domain you selected is not owned by all of the selected users. Changing, increasing or deleting the domain will affect all selected users.",
          { timeout: 8000 },
        );
      }
      return {
        domain: entry,
        value: 1,
        removed,
      };
    });
    this.setState(prevState => ({
      changeEntries: _.concat(prevState.changeEntries, newExperiences).sort(
        Utils.localeCompareBy(([]: Array<EditTableEntry>), entry => entry.domain.toLowerCase()),
      ),
      enteredExperiences: [],
    }));
  };

  getDomainsOfTable = (): ExperienceDomainListType =>
    this.state.changeEntries.map(entry => entry.domain);

  renderSharedExperienceTable = () => {
    const sharedExperiencesEntries = this.state.sharedExperiencesEntries;
    if (sharedExperiencesEntries && sharedExperiencesEntries.length > 0) {
      return (
        <Table
          title={() => "Shared Experience Domains"}
          size="small"
          dataSource={sharedExperiencesEntries}
          rowKey="domain"
          pagination={false}
          scroll={150}
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
      );
    } else if (this.props.selectedUsers.length > 1) {
      return (
        <span>
          <Icon type="info-circle-o" />The selected users don′t have shared Experience Domains.
        </span>
      );
    } else return null;
  };

  render() {
    if (!this.props.visible && this.props.selectedUsers.length === 0) {
      return null;
    }
    const changeEntries = this.state.changeEntries;
    const isValid = this.validateDomainAndValues(changeEntries);
    const mutlipleUsers = this.props.selectedUsers.length > 1;
    const scroll = { y: mutlipleUsers ? 150 : 325 };
    return (
      <Modal
        className="experience-change-modal"
        title={
          mutlipleUsers
            ? "Change Experiences of Multiple Users"
            : "Change Experiences of a Single Users"
        }
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        maskClosable={false}
        width={800}
        footer={
          <div>
            <Button
              type="primary"
              onClick={this.updateMultipleUsersExperiences}
              disabled={!isValid}
            >
              Submit Changes
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Table
          title={
            mutlipleUsers
              ? "Changes"
              : `Experiences of User ${this.props.selectedUsers[0].lastName} , ${
                  this.props.selectedUsers[0].firstName
                }`
          }
          size="small"
          dataSource={changeEntries}
          rowKey="domain"
          pagination={false}
          scroll={scroll}
          className="user-experience-table"
        >
          <Column
            title="Experience Domain"
            key="domain"
            render={record =>
              record.removed ? <div className="disabled">{record.domain}</div> : record.domain
            }
          />
          <Column
            title="Experience Value"
            key="value"
            width="20%"
            render={record => {
              const index = changeEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  <InputNumber
                    disabled={record.removed}
                    value={changeEntries[index].value}
                    onChange={value => this.setValueOfEntry(index, value)}
                  />
                  {!mutlipleUsers && this.recordModifiedAndExistedBefore(record) ? (
                    <Tooltip placement="top" title="Revert Changes">
                      <Icon
                        style={{ marginLeft: 15 }}
                        className={record.removed ? "disabled-clickable-icon" : "clickable-icon"}
                        type="rollback"
                        onClick={record.removed ? null : () => this.revertChangesOfEntry(index)}
                      />
                    </Tooltip>
                  ) : null}
                </span>
              );
            }}
          />
          <Column
            title="Delete Entry"
            key="removed"
            width="10%"
            render={record => {
              const index = changeEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  {record.removed ? (
                    <Tooltip placement="top" title="Undo">
                      <Icon
                        type="rollback"
                        className="clickable-icon"
                        onClick={() => this.setRemoveOfEntryTo(index, false)}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip placement="top" title="Delete this Domain">
                      <Icon
                        type="delete"
                        className="clickable-icon"
                        onClick={() => this.setRemoveOfEntryTo(index, true)}
                      />
                    </Tooltip>
                  )}
                </span>
              );
            }}
          />
          {mutlipleUsers ? (
            <Column
              width="10%"
              render={record => {
                const index = changeEntries.findIndex(entry => entry.domain === record.domain);
                return (
                  <Tooltip placement="top" title="Remove Entry">
                    <Icon
                      type="close"
                      className="clickable-icon"
                      onClick={() => this.removeEntryFromTable(index)}
                    />
                  </Tooltip>
                );
              }}
            />
          ) : null}
        </Table>
        <span>
          <SelectExperienceDomain
            disabled={false}
            value={this.state.enteredExperiences}
            onSelect={this.handleExperienceSelected}
            onDeselect={this.handleExperienceDeselected}
            alreadyUsedDomains={this.getDomainsOfTable()}
          />
          {this.state.enteredExperiences.length > 0 ? (
            <Tooltip placement="top" title="Clear Input">
              <Icon
                type="close-circle"
                className="clear-input-icon clickable-icon"
                onClick={() => this.setState({ enteredExperiences: [] })}
              />
            </Tooltip>
          ) : null}
          {mutlipleUsers ? (
            <Button
              className="add-button"
              disabled={!this.state.enteredExperiences || this.state.enteredExperiences.length <= 0}
              onClick={() => this.addEnteredExperiences(true)}
            >
              {this.state.enteredExperiences.length <= 1
                ? "Remove Experience"
                : "Remove Experiences"}
            </Button>
          ) : null}
          <Button
            className="add-button"
            disabled={!this.state.enteredExperiences || this.state.enteredExperiences.length <= 0}
            onClick={() => this.addEnteredExperiences(false)}
          >
            {this.state.enteredExperiences.length <= 1 ? "Add Experience" : "Add Experiences"}
          </Button>
        </span>
      </Modal>
    );
  }
}

export default ExperienceModalView;
