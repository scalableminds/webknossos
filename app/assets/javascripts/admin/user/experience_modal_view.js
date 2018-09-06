// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber } from "antd";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { updateUser } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import type {
  APIUserType,
  ExperienceDomainListType,
  ExperienceMapType,
} from "admin/api_flow_types";
import SelectExperienceDomain from "components/select_experience_domain";

const { Column } = Table;

type SharedTableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
};

type EditTableEntry = {
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
  sharedExperiencesEntries: Array<SharedTableEntry>,
  changeEntries: Array<EditTableEntry>,
  enteredExperiences: ExperienceDomainListType,
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

  loadSharedTableEntries = (users: Array<APIUserType>): Array<SharedTableEntry> => {
    if (users.length <= 1) {
      return [];
    }
    // find all existing experience domains
    let sharedTableEntries: Array<SharedTableEntry> = [];
    users.forEach(user => {
      Object.keys(user.experiences).forEach(experience => {
        if (!sharedTableEntries.find(entry => entry.domain === experience)) {
          sharedTableEntries.push({
            domain: experience,
            value: 0,
            lowestValue: 0,
            highestValue: -1,
          });
        }
      });
    });
    // create sharedTableEntries
    sharedTableEntries = sharedTableEntries.map(entry => {
      let highestValue = -1;
      let lowestValue = -1;
      const domain = entry.domain;
      users.forEach(user => {
        const experiences = user.experiences;
        if (domain in experiences) {
          highestValue = highestValue > experiences[domain] ? highestValue : experiences[domain];
          lowestValue =
            lowestValue < experiences[domain] && lowestValue !== -1
              ? highestValue
              : experiences[domain];
        } else {
          lowestValue = 0;
        }
      });
      return { domain, highestValue, lowestValue, value: lowestValue };
    });
    // sort entries
    return sharedTableEntries.sort(
      Utils.localeCompareBy(([]: Array<SharedTableEntry>), entry => entry.domain.toLowerCase()),
    );
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

  updatedAllUsers = async () => {
    const newExperiences: ExperienceMapType = [];
    const relevantEntries =
      this.props.selectedUsers.length === 1
        ? this.state.changeEntries
        : this.state.sharedTableEntries;

    relevantEntries.forEach(entry => {
      newExperiences[entry.domain] = entry.value;
    });

    const newUserPromises = this.props.selectedUsers.map(user => {
      const newUser = { ...user, experiences: newExperiences };
      return this.sendUserToServer(newUser, user);
    });
    this.resolvePromisesAndCloseModal(newUserPromises);
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
      if (this.state.selectedUsers.length > 1) {
        this.setState(prevState => ({
          sharedExperiencesEntries: prevState.sharedExperiencesEntries.map(
            (entry, currentIndex) => {
              if (currentIndex === index) {
                return {
                  ...entry,
                  value,
                };
              } else {
                return entry;
              }
            },
          ),
        }));
      } else {
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
    } else {
      this.setState(prevState => ({
        sharedExperiencesEntries: prevState.sharedExperiencesEntries.map((entry, currentIndex) => {
          if (currentIndex === index) {
            return {
              ...entry,
              value: entry.lowestValue,
            };
          } else {
            return entry;
          }
        }),
      }));
    }
  };

  removeEntryFromTable = (index: number) => {
    if (this.props.selectedUsers.length === 1) {
      this.setState(prevState => ({
        changeEntries: prevState.changeEntries.filter(
          entry => entry.domain !== prevState.changeEntries[index].domain,
        ),
      }));
    } else {
      this.setState(prevState => ({
        sharedExperiencesEntries: prevState.sharedExperiencesEntries.filter(
          entry => entry.domain !== prevState.sharedExperiencesEntries[index].domain,
        ),
      }));
    }
  };

  addEnteredExperiences = () => {
    const newExperiences = this.state.enteredExperiences.map(entry => {
      if (this.props.selectedUsers === 1) {
        return {
          domain: entry,
          value: 1,
        };
      } else {
        return {
          domain: entry,
          value: 1,
          lowestValue: -1,
          highestValue: -1,
        };
      }
    });
    if (this.props.selectedUsers.length === 1) {
      this.setState(prevState => ({
        changeEntries: _.concat(prevState.changeEntries, newExperiences).sort(
          Utils.localeCompareBy(([]: Array<EditTableEntry>), entry => entry.domain.toLowerCase()),
        ),
        enteredExperiences: [],
      }));
    } else {
      this.setState(prevState => ({
        sharedExperiencesEntries: _.concat(prevState.sharedExperiencesEntries, newExperiences).sort(
          Utils.localeCompareBy(([]: Array<EditTableEntry>), entry => entry.domain.toLowerCase()),
        ),
        enteredExperiences: [],
      }));
    }
  };

  getDomainsOfTable = (): ExperienceDomainListType => {
    const relevantEntries =
      this.props.selectedUsers.length === 1
        ? this.state.changeEntries
        : this.state.sharedExperiencesEntries;
    return relevantEntries.map(entry => entry.domain);
  };

  /* renderSharedExperienceTable = () => {
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
  }; */

  render() {
    if (!this.props.visible && this.props.selectedUsers.length === 0) {
      return null;
    }
    const changeEntries = this.state.changeEntries;
    const sharedExperiencesEntries = this.state.sharedExperiencesEntries;
    const mutlipleUsers = this.props.selectedUsers.length > 1;
    const scroll = { y: mutlipleUsers ? 150 : 325 };
    return (
      <Modal
        className="experience-change-modal"
        title={
          mutlipleUsers
            ? "Changes Experiences of Multiple Users"
            : `Change Experiences of User ${this.props.selectedUsers[0].lastName} , ${
                this.props.selectedUsers[0].firstName
              }`
        }
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        maskClosable={false}
        width={800}
        footer={
          <div>
            <Button type="primary" onClick={this.updatedAllUsers}>
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
          dataSource={mutlipleUsers ? sharedExperiencesEntries : changeEntries}
          rowKey="domain"
          pagination={false}
          scroll={scroll}
          className="user-experience-table"
        >
          <Column title="Experience Domain" key="domain" dataIndex="domain" />
          {mutlipleUsers ? (
            <Column
              title="Experience Value"
              key="value"
              width="25%"
              render={record =>
                record.highestValue === record.lowestValue
                  ? record.value
                  : `varying from ${record.lowestValue} to ${record.highestValue}`
              }
            />
          ) : null}
          <Column
            title="Experience Value"
            key="value"
            width="20%"
            render={record => {
              const relevantEntries =
                this.props.selectedUsers.length === 1
                  ? this.state.changeEntries
                  : this.state.sharedExperiencesEntries;
              const index = relevantEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  <InputNumber
                    value={relevantEntries[index].value}
                    onChange={value => this.setValueOfEntry(index, value)}
                  />
                  {mutlipleUsers || this.recordModifiedAndExistedBefore(record) ? (
                    <Tooltip placement="top" title="Revert Changes">
                      <Icon
                        style={{ marginLeft: 15 }}
                        className="clickable-icon"
                        type="rollback"
                        onClick={() => this.revertChangesOfEntry(index)}
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
                  <Tooltip placement="top" title="Remove Entry">
                    <Icon
                      type="delete"
                      className="clickable-icon"
                      onClick={() => this.removeEntryFromTable(index)}
                    />
                  </Tooltip>
                </span>
              );
            }}
          />
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
