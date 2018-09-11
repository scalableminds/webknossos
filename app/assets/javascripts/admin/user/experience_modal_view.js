// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table, InputNumber, Checkbox, Tag } from "antd";
import * as Utils from "libs/utils";
import { updateUser } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import SelectExperienceDomain from "components/select_experience_domain";

const { Column } = Table;

type TableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
  isShared: boolean,
  changed: boolean,
};

type Props = {
  onChange: (Array<APIUserType>) => void,
  onCancel: () => void,
  visible: boolean,
  selectedUsers: Array<APIUserType>,
};

type State = {
  tableEntries: Array<TableEntry>,
  removedDomains: Array<string>,
  showOnlySharedExperiences: boolean,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      tableEntries: this.loadTableEntries(props.selectedUsers),
      removedDomains: [],
      showOnlySharedExperiences: false,
    };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({
        tableEntries: this.loadTableEntries(nextProps.selectedUsers),
        removedDomains: [],
        showOnlySharedExperiences: false,
      });
    }
  }

  sortEntries(entries: Array<TableEntry>): Array<TableEntry> {
    return entries.sort(
      Utils.localeCompareBy(([]: Array<TableEntry>), entry => entry.domain.toLowerCase()),
    );
  }

  loadTableEntries = (users: Array<APIUserType>): Array<TableEntry> => {
    if (users.length <= 1) {
      return this.sortEntries(
        _.map(users[0].experiences, (value, domain) => ({
          domain,
          value,
          lowestValue: -1,
          highestValue: -1,
          isShared: true,
          changed: false,
        })),
      );
    }
    // find all existing experience domains
    const allSharedDomains: Array<string> = _.intersection(
      ...users.map(user => Object.keys(user.experiences)),
    );
    const allDomains: Array<string> = _.union(...users.map(user => Object.keys(user.experiences)));
    const tableEntries = allDomains.map(domain => {
      const usersValues = users.map(user => user.experiences[domain]);
      const min = _.min(usersValues);
      const max = _.max(usersValues);
      const isShared = allSharedDomains.indexOf(domain) > -1;
      const value = isShared && max === min ? min : -1;
      return {
        domain,
        value,
        lowestValue: min,
        highestValue: max,
        isShared,
        changed: false,
      };
    });
    return this.sortEntries(tableEntries);
  };

  updateAllUsers = async () => {
    let relevantEntries = this.state.tableEntries.filter(
      entry =>
        entry.changed || (entry.lowestValue === entry.highestValue && entry.highestValue >= 0),
    );
    if (this.state.showOnlySharedExperiences) {
      relevantEntries = this.state.tableEntries.filter(entry => entry.isShared);
    }
    const newUserPromises: Array<Promise<APIUserType>> = this.props.selectedUsers.map(user => {
      const newExperiences = {
        ...user.experiences,
        ..._.fromPairs(relevantEntries.map(entry => [entry.domain, entry.value])),
      };
      this.state.removedDomains.forEach(domain => {
        if (domain in newExperiences) {
          delete newExperiences[domain];
        }
      });
      const orderedExperiences = {};
      Object.keys(newExperiences)
        .sort()
        .forEach(key => {
          orderedExperiences[key] = newExperiences[key];
        });
      const newUser = { ...user, experiences: orderedExperiences };
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
          tableEntries: [],
        });
        this.props.onChange(newUsers);
      },
      error => {
        handleGenericError(error);
      },
    );
  }

  setValueOfEntry = (index: number, value: number) => {
    if (value >= 0) {
      this.setState(prevState => ({
        tableEntries: prevState.tableEntries.map((entry, currentIndex) => {
          if (currentIndex === index) {
            return {
              ...entry,
              value,
              changed: true,
            };
          } else {
            return entry;
          }
        }),
      }));
    }
  };

  revertChangesOfEntry = (index: number) => {
    this.setState(prevState => ({
      tableEntries: prevState.tableEntries.map((entry, currentIndex) => {
        if (currentIndex === index) {
          const value =
            (this.props.selectedUsers.length === 1 &&
              entry.domain in this.props.selectedUsers[0].experiences) ||
            (entry.isShared && entry.lowestValue === entry.highestValue && entry.highestValue >= 0)
              ? this.props.selectedUsers[0].experiences[entry.domain]
              : -1;
          return {
            ...entry,
            value,
            changed: false,
          };
        } else {
          return entry;
        }
      }),
    }));
  };

  removeEntryFromTable = (domain: string) => {
    this.setState(prevState => ({
      tableEntries: prevState.tableEntries.filter(entry => entry.domain !== domain),
      removedDomains: _.concat(prevState.removedDomains, domain),
    }));
  };

  addEnteredExperience = (domain: string) => {
    if (this.state.tableEntries.findIndex(entry => entry.domain === domain) > -1) {
      return;
    }
    const newExperience: TableEntry = {
      domain,
      value: -1,
      lowestValue: -1,
      highestValue: -1,
      isShared: true,
      changed: false,
    };
    this.setState(prevState => ({
      tableEntries: this.sortEntries(_.concat(prevState.tableEntries, newExperience)),
      removedDomains: prevState.removedDomains.filter(currentDomain => currentDomain !== domain),
    }));
  };

  getDomainsOfTable = (): ExperienceDomainListType =>
    this.state.tableEntries.map(entry => entry.domain);

  render() {
    if (!this.props.visible && this.props.selectedUsers.length === 0) {
      return null;
    }
    const tableEntries = this.state.tableEntries.filter(
      entry => !this.state.showOnlySharedExperiences || entry.isShared,
    );
    const multipleUsers = this.props.selectedUsers.length > 1;
    return (
      <Modal
        className="experience-change-modal"
        title={
          multipleUsers
            ? "Changes Experiences of Selected Users"
            : `Change Experiences for ${this.props.selectedUsers[0].firstName} , ${
                this.props.selectedUsers[0].lastName
              }`
        }
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        maskClosable={false}
        width={850}
        footer={
          <div>
            <Button type="primary" onClick={this.updateAllUsers}>
              Submit Changes
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        {multipleUsers ? (
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
          dataSource={tableEntries}
          rowKey="domain"
          pagination={false}
          scroll={{ y: 350 }}
          className="user-experience-table"
        >
          <Column
            title="Experience Domain"
            key="domain"
            dataIndex="domain"
            width={multipleUsers ? "25%" : "40%"}
          />
          {multipleUsers ? (
            <Column
              title="Current Experience Value"
              width="25%"
              render={(record: TableEntry) => {
                if (record.highestValue === -1 && record.lowestValue === -1) return "";
                return record.highestValue === record.lowestValue
                  ? record.highestValue
                  : `varying from ${record.lowestValue} to ${record.highestValue}`;
              }}
            />
          ) : null}
          {multipleUsers ? (
            <Column
              title="Is Shared"
              width="10%"
              className="centered-table-item"
              render={(record: TableEntry) =>
                record.isShared ? (
                  <Icon type="check" theme="outlined" />
                ) : (
                  <Icon type="close" theme="outlined" />
                )
              }
            />
          ) : null}
          )
          <Column
            title="Experience Value"
            key="value"
            width={multipleUsers ? "25%" : "40%"}
            render={record => {
              const index = this.state.tableEntries.findIndex(
                entry => entry.domain === record.domain,
              );
              return (
                <span>
                  <InputNumber
                    value={
                      this.state.tableEntries[index].value > -1
                        ? this.state.tableEntries[index].value
                        : ""
                    }
                    onChange={value => this.setValueOfEntry(index, value)}
                  />
                  {record.changed ? (
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
            width={multipleUsers ? "15%" : "20%"}
            render={record => (
              <span>
                <Tooltip placement="top" title="Remove Entry">
                  <Icon
                    type="delete"
                    className="clickable-icon"
                    onClick={() => this.removeEntryFromTable(record.domain)}
                  />
                </Tooltip>
              </span>
            )}
          />
        </Table>
        {multipleUsers && this.state.removedDomains.length > 0 ? (
          <div style={{ marginBottom: 24 }}>
            These Experience Domains will be removed from the selected Users:<br />
            {this.state.removedDomains.map((domain: string) => (
              <Tooltip key={domain} placement="top" title="Do not remove this Domain">
                <Tag
                  style={{ magin: 8, marginTop: 10 }}
                  className="clickable-icon"
                  onClick={() => {
                    this.setState(prevState => ({
                      removedDomains: prevState.removedDomains.filter(
                        currentDomain => currentDomain !== domain,
                      ),
                    }));
                  }}
                >
                  {domain} <Icon type="close" theme="outlined" />
                </Tag>
              </Tooltip>
            ))}
          </div>
        ) : null}
        <SelectExperienceDomain
          disabled={false}
          value={[]}
          width={50}
          onSelect={this.addEnteredExperience}
          onDeselect={() => {}}
          alreadyUsedDomains={this.getDomainsOfTable()}
        />
      </Modal>
    );
  }
}

export default ExperienceModalView;
