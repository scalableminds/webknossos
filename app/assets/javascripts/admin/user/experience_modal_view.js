// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber, Checkbox } from "antd";
import * as Utils from "libs/utils";
import { updateUser } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import SelectExperienceDomain from "components/select_experience_domain";

const { Column } = Table;

// TODO => visual bug when editing a value of a domain the first time !!!

type MultipleUserTableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
  isShared: boolean,
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
  showOnlySharedExperiences: boolean,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      multipleUsersEntries: this.loadMultipleUserEntries(props.selectedUsers),
      singleUsersEntries: this.loadSingleUserEntries(props.selectedUsers),
      showOnlySharedExperiences: false,
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({
        multipleUsersEntries: this.loadMultipleUserEntries(nextProps.selectedUsers),
        singleUsersEntries: this.loadSingleUserEntries(nextProps.selectedUsers),
      });
    }
  }

  loadMultipleUserEntries = (users: Array<APIUserType>): Array<MultipleUserTableEntry> => {
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
            isShared: true,
          });
        }
      });
    });
    // create sharedTableEntries
    sharedTableEntries = sharedTableEntries.map(entry => {
      let highestValue = -1;
      let lowestValue = -1;
      let isShared = true;
      const domain = entry.domain;
      users.forEach(user => {
        const experiences = user.experiences;
        if (domain in experiences) {
          highestValue = highestValue > experiences[domain] ? highestValue : experiences[domain];
          lowestValue =
            lowestValue < experiences[domain] && lowestValue !== -1
              ? lowestValue
              : experiences[domain];
        } else {
          isShared = false;
          lowestValue = 0;
        }
      });
      return { domain, highestValue, lowestValue, value: lowestValue, isShared };
    });
    // sort entries
    return sharedTableEntries.sort(
      Utils.localeCompareBy(([]: Array<MultipleUserTableEntry>), entry =>
        entry.domain.toLowerCase(),
      ),
    );
  };

  loadSingleUserEntries = (users: Array<APIUserType>): Array<SingleUserTableEntry> =>
    users.length === 1
      ? _.map(users[0].experiences, (value, domain) => ({
          domain,
          value,
        })).sort(
          Utils.localeCompareBy(([]: Array<SingleUserTableEntry>), entry =>
            entry.domain.toLowerCase(),
          ),
        )
      : [];

  updatedAllUsers = async () => {
    const newExperiences = {};
    if (this.props.selectedUsers.length === 1) {
      this.state.singleUsersEntries.forEach(entry => {
        newExperiences[entry.domain] = entry.value;
      });
    } else {
      this.state.multipleUsersEntries.forEach(entry => {
        newExperiences[entry.domain] = entry.value;
      });
    }
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
      if (this.props.selectedUsers.length === 1) {
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
      } else {
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
      if (this.state.singleUsersEntries.findIndex(entry => entry.domain === domain) > -1) {
        return;
      }
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
      if (this.state.multipleUsersEntries.findIndex(entry => entry.domain === domain) > -1) {
        return;
      }
      const newExperience: MultipleUserTableEntry = {
        domain,
        value: 1,
        lowestValue: -1,
        highestValue: -1,
        isShared: true,
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

  getDomainsOfTable = (): ExperienceDomainListType =>
    this.props.selectedUsers.length === 1
      ? this.state.singleUsersEntries.map(entry => entry.domain)
      : this.state.multipleUsersEntries.map(entry => entry.domain);

  render() {
    if (!this.props.visible && this.props.selectedUsers.length === 0) {
      return null;
    }
    const singleUsersEntries = this.state.singleUsersEntries;
    // applies optional filter for shared entries
    const multipleUsersEntries = this.state.multipleUsersEntries.filter(
      entry => !this.state.showOnlySharedExperiences || entry.isShared,
    );
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
        {mutlipleUsers ? (
          <Checkbox
            style={{ marginTop: 24, marginBottom: 24 }}
            onChange={(e: SyntheticInputEvent<>) =>
              this.setState({ showOnlySharedExperiences: e.target.checked })
            }
          >
            Show Only Shared Experience Domains
          </Checkbox>
        ) : null}
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
              width="30%"
              render={(record: MultipleUserTableEntry) =>
                // eslint-disable-next-line no-nested-ternary
                record.highestValue === -1 && record.lowestValue === -1
                  ? ""
                  : record.highestValue === record.lowestValue
                    ? record.highestValue
                    : `varying from ${record.lowestValue} to ${record.highestValue}`
              }
            />
          ) : null}
          <Column
            title="Experience Value"
            key="value"
            width={mutlipleUsers ? "25%" : "40%"}
            render={record => {
              const index = mutlipleUsers
                ? this.state.multipleUsersEntries.findIndex(entry => entry.domain === record.domain)
                : this.state.singleUsersEntries.findIndex(entry => entry.domain === record.domain);
              return (
                <span>
                  <InputNumber
                    value={
                      mutlipleUsers
                        ? this.state.multipleUsersEntries[index].value
                        : this.state.singleUsersEntries[index].value
                    }
                    onChange={value => this.setValueOfEntry(index, value)}
                  />
                  {(mutlipleUsers && record.value !== record.lowestValue) ||
                  this.recordModifiedAndExistedBefore(record) ? (
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
            width={mutlipleUsers ? "15%" : "20%"}
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
          value={[]}
          onSelect={this.addEnteredExperience}
          onDeselect={() => {}}
          alreadyUsedDomains={this.getDomainsOfTable()}
        />
      </Modal>
    );
  }
}

export default ExperienceModalView;
