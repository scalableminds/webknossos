// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber } from "antd";
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

// TODO => visual bug when editing a value of a domain the first time !!!

type MultipleUserTableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
};

type SingleUserTableEntry = {
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
  multipleUsersEntries: Array<MultipleUserTableEntry>,
  singleUsersEntries: Array<SingleUserTableEntry>,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      multipleUsersEntries: this.loadSharedTableEntries(props.selectedUsers),
      singleUsersEntries: this.loadChangeTableEntries(props.selectedUsers),
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({
        multipleUsersEntries: this.loadSharedTableEntries(nextProps.selectedUsers),
        singleUsersEntries: this.loadChangeTableEntries(nextProps.selectedUsers),
      });
    }
  }

  loadSharedTableEntries = (users: Array<APIUserType>): Array<MultipleUserTableEntry> => {
    if (users.length <= 1) {
      return [];
    }
    // find all existing experience domains
    let sharedTableEntries: Array<MultipleUserTableEntry> = [];
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
      Utils.localeCompareBy(([]: Array<MultipleUserTableEntry>), entry =>
        entry.domain.toLowerCase(),
      ),
    );
  };

  loadChangeTableEntries = (users: Array<APIUserType>): Array<SingleUserTableEntry> =>
    users.length === 1
      ? _.map(users[0].experiences, (value, domain) => ({
          domain,
          value,
          removed: false,
        })).sort(
          Utils.localeCompareBy(([]: Array<SingleUserTableEntry>), entry =>
            entry.domain.toLowerCase(),
          ),
        )
      : [];

  updatedAllUsers = async () => {
    const newExperiences: ExperienceMapType = {};
    const relevantEntries =
      this.props.selectedUsers.length === 1
        ? this.state.singleUsersEntries
        : this.state.sharedTableEntries;

    relevantEntries.forEach(entry => {
      newExperiences[entry.domain] = entry.value;
    });

    const newUserPromises = this.props.selectedUsers.map(user => {
      const newUser = { ...user, experiences: newExperiences };
      console.log(newUser);
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
          multipleUsersEntries: [],
          singleUsersEntries: [],
        });
        this.props.onChange(newUsers);
      },
      error => {
        handleGenericError(error);
      },
    );
  }

  recordModifiedAndExistedBefore = (record: SingleUserTableEntry): boolean => {
    if (this.props.selectedUsers.length === 1)
      return (
        record.value !== this.props.selectedUsers[0].experiences[record.domain] &&
        record.domain in this.props.selectedUsers[0].experiences
      );
    else return false;
  };

  setValueOfEntry = (index: number, value: number) => {
    if (value > 0) {
      if (this.props.selectedUsers.length > 1) {
        this.setState(prevState => ({
          multipleUsersEntries: prevState.multipleUsersEntries.map((entry, currentIndex) => {
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
      } else {
        this.setState(prevState => ({
          singleUsersEntries: prevState.singleUsersEntries.map((entry, currentIndex) => {
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
        singleUsersEntries: prevState.singleUsersEntries.map((entry, currentIndex) => {
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
        multipleUsersEntries: prevState.multipleUsersEntries.map((entry, currentIndex) => {
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
        singleUsersEntries: prevState.singleUsersEntries.filter(
          entry => entry.domain !== prevState.singleUsersEntries[index].domain,
        ),
      }));
    } else {
      this.setState(prevState => ({
        multipleUsersEntries: prevState.multipleUsersEntries.filter(
          entry => entry.domain !== prevState.multipleUsersEntries[index].domain,
        ),
      }));
    }
  };

  addEnteredExperience = (domain: string) => {
    if (this.props.selectedUsers.length === 1) {
      const newExperience: SingleUserTableEntry = {
        domain,
        value: 1,
      };
      this.setState(prevState => ({
        singleUsersEntries: _.concat(prevState.singleUsersEntries, newExperience).sort(
          Utils.localeCompareBy(([]: Array<SingleUserTableEntry>), entry =>
            entry.domain.toLowerCase(),
          ),
        ),
      }));
    } else {
      const newExperience: MultipleUserTableEntry = {
        domain,
        value: 1,
        lowestValue: -1,
        highestValue: -1,
      };
      this.setState(prevState => ({
        multipleUsersEntries: _.concat(prevState.multipleUsersEntries, newExperience).sort(
          Utils.localeCompareBy(([]: Array<SingleUserTableEntry>), entry =>
            entry.domain.toLowerCase(),
          ),
        ),
      }));
    }
  };

  getDomainsOfTable = (): ExperienceDomainListType => {
    const relevantEntries =
      this.props.selectedUsers.length === 1
        ? this.state.singleUsersEntries
        : this.state.multipleUsersEntries;
    return relevantEntries.map(entry => entry.domain);
  };

  render() {
    if (!this.props.visible && this.props.selectedUsers.length === 0) {
      return null;
    }
    const singleUsersEntries = this.state.singleUsersEntries;
    const multipleUsersEntries = this.state.multipleUsersEntries;
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
          size="small"
          dataSource={mutlipleUsers ? multipleUsersEntries : singleUsersEntries}
          rowKey="domain"
          pagination={false}
          scroll={scroll}
          className="user-experience-table"
        >
          <Column
            title="Experience Domain"
            key="domain"
            dataIndex="domain"
            width={mutlipleUsers ? "30%" : "40%"}
          />
          {mutlipleUsers ? (
            <Column
              title="Current Experience Value"
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
            width={mutlipleUsers ? "25%" : "40%"}
            render={record => {
              const relevantEntries =
                this.props.selectedUsers.length === 1
                  ? this.state.singleUsersEntries
                  : this.state.multipleUsersEntries;
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
            width="20%"
            render={record => {
              const index = singleUsersEntries.findIndex(entry => entry.domain === record.domain);
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
        <SelectExperienceDomain
          disabled={false}
          onSelect={this.addEnteredExperience}
          onDeselect={() => {}}
          alreadyUsedDomains={this.getDomainsOfTable()}
        />
      </Modal>
    );
  }
}

export default ExperienceModalView;
