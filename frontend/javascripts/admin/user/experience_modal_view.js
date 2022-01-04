// @flow

import { Modal, Button, Tooltip, Table, InputNumber, Tag, Badge } from "antd";
import { CloseOutlined, DeleteOutlined, RollbackOutlined } from "@ant-design/icons";
import * as React from "react";
import _ from "lodash";

import type { APIUser, ExperienceDomainList } from "types/api_flow_types";
import { handleGenericError } from "libs/error_handling";
import { updateUser } from "admin/admin_rest_api";
import HighlightableRow from "components/highlightable_row";
import SelectExperienceDomain from "components/select_experience_domain";
import Toast from "libs/toast";
import * as Utils from "libs/utils";

const { Column } = Table;

// Value being -1 means that this entry has no changes and that not all users did share this value in the beginning

// A -1 for lowestValue and highestValue indicate that these values are invalid
// -> happens when a new domain is added.
// Used to render "Current Experience Value" and used while reverting changes

// sharedByCount is the number of users that had the entry in beforehand
type TableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
  sharedByCount: number,
  changed: boolean,
};

type Props = {
  onChange: (Array<APIUser>) => void,
  onCancel: () => void,
  visible: boolean,
  selectedUsers: Array<APIUser>,
  initialDomainToEdit: ?string,
};

type State = {
  tableEntries: Array<TableEntry>,
  removedDomains: Array<string>,
  domainToEdit: ?string,
};

class ExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      tableEntries: this.getTableEntries(props.selectedUsers),
      removedDomains: [],
      domainToEdit: props.initialDomainToEdit,
    };
  }

  sortEntries(entries: Array<TableEntry>): Array<TableEntry> {
    return entries.sort(
      Utils.localeCompareBy(([]: Array<TableEntry>), entry => entry.domain.toLowerCase()),
    );
  }

  getTableEntries = (users: Array<APIUser>): Array<TableEntry> => {
    if (users.length <= 1) {
      return this.sortEntries(
        _.map(users[0].experiences, (value, domain) => ({
          domain,
          value,
          lowestValue: -1,
          highestValue: -1,
          sharedByCount: 1,
          changed: false,
        })),
      );
    }
    // find all existing experience domains
    const allDomains: Array<string> = _.union(...users.map(user => Object.keys(user.experiences)));
    // adds the number of users with this domain (sharedByCount) to all domains
    const allDomainsWithCount = allDomains.map(domain => {
      let sharedByCount = 0;
      users.forEach(user => {
        if (domain in user.experiences) {
          sharedByCount++;
        }
      });
      return { domain, sharedByCount };
    });
    // create a table entry for each domain
    const tableEntries = allDomainsWithCount.map(entry => {
      const usersValues = users.map(user => user.experiences[entry.domain]);
      const min = _.min(usersValues);
      const max = _.max(usersValues);
      const isShared = entry.sharedByCount === users.length;
      const value = isShared && max === min ? min : -1;
      return {
        domain: entry.domain,
        value,
        lowestValue: min,
        highestValue: max,
        sharedByCount: entry.sharedByCount,
        changed: false,
      };
    });
    return this.sortEntries(tableEntries);
  };

  updateAllUsers = async () => {
    const relevantEntries = this.state.tableEntries.filter(entry => entry.changed);
    const newUserPromises: Array<Promise<APIUser>> = this.props.selectedUsers.map(
      (user: APIUser) => {
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
          .sort(Utils.localeCompareBy(([]: Array<string>), domain => domain.toLowerCase()))
          .forEach(key => {
            orderedExperiences[key] = newExperiences[key];
          });
        const newUser = { ...user, experiences: orderedExperiences };
        return this.sendUserToServer(newUser, user);
      },
    );
    this.resolvePromisesAndCloseModal(newUserPromises);
  };

  sendUserToServer(newUser: APIUser, oldUser: APIUser): Promise<APIUser> {
    return updateUser(newUser).then(() => Promise.resolve(newUser), () => Promise.reject(oldUser));
  }

  resolvePromisesAndCloseModal(usersPromises: Array<Promise<APIUser>>): void {
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
    if (value < 0 || typeof value !== "number") {
      return;
    }
    this.setState(prevState => ({
      tableEntries: prevState.tableEntries.map((entry, currentIndex) => {
        if (currentIndex !== index) {
          return entry;
        }
        return {
          ...entry,
          value,
          changed: true,
        };
      }),
    }));
  };

  revertChangesOfEntry = (index: number) => {
    this.setState(prevState => ({
      tableEntries: prevState.tableEntries.map((entry, currentIndex) => {
        if (currentIndex !== index) {
          return entry;
        }
        // only able to revert to a value when in single-user mode and the user already had this domain
        // or when in multiple-user mode and the domain was shared beforehand and all users have the same value
        // -> sharedByCount === count of users and highestValue === lowestValue and highestValue >= 0 -> not -1
        const firstUser = this.props.selectedUsers[0];
        const isSingleUserWithEntry =
          this.props.selectedUsers.length === 1 && entry.domain in firstUser.experiences;
        const isShared = entry.sharedByCount === this.props.selectedUsers.length;
        const isValueSharedAndExistedBefore =
          isShared && entry.lowestValue === entry.highestValue && entry.highestValue >= 0;
        const value =
          isSingleUserWithEntry || isValueSharedAndExistedBefore
            ? firstUser.experiences[entry.domain]
            : -1;
        return {
          ...entry,
          value,
          changed: false,
        };
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
    if (domain.length < 3) {
      Toast.warning("An experience domain needs at least 3 letters.");
      return;
    }
    if (this.state.tableEntries.findIndex(entry => entry.domain === domain) > -1) {
      return;
    }
    // a newly entered domain is owned by everyone but has invalid lowest and highest values
    const newExperience: TableEntry = {
      domain,
      value: -1,
      lowestValue: -1,
      highestValue: -1,
      sharedByCount: this.props.selectedUsers.length,
      changed: false,
    };
    this.setState(prevState => ({
      tableEntries: this.sortEntries(_.concat(prevState.tableEntries, newExperience)),
      removedDomains: prevState.removedDomains.filter(currentDomain => currentDomain !== domain),
      domainToEdit: domain,
    }));
  };

  getDomainsOfTable = (): ExperienceDomainList =>
    this.state.tableEntries.map(entry => entry.domain);

  render() {
    const selectedUsersCount = this.props.selectedUsers.length;
    if (!this.props.visible && selectedUsersCount === 0) {
      return null;
    }
    const { tableEntries } = this.state;
    const multipleUsers = selectedUsersCount > 1;
    return (
      <Modal
        className="experience-change-modal"
        title={
          multipleUsers
            ? `Change Experiences of ${selectedUsersCount} Users`
            : `Change Experiences for ${this.props.selectedUsers[0].firstName} ${
                this.props.selectedUsers[0].lastName
              }`
        }
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        width={multipleUsers ? 800 : 600}
        maskClosable={false}
        footer={
          <div>
            <Button type="primary" onClick={this.updateAllUsers}>
              Save
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Table
          size="small"
          dataSource={tableEntries}
          rowKey="domain"
          pagination={false}
          scroll={{ y: 350 }}
          className="user-experience-table"
          components={{
            body: {
              row: HighlightableRow,
            },
          }}
          onRow={record => ({
            shouldHighlight: record.domain === this.state.domainToEdit,
          })}
        >
          <Column
            title="Domain"
            key="domain"
            dataIndex="domain"
            width={multipleUsers ? "35%" : "40%"}
          />
          {multipleUsers ? (
            <Column
              title="Current Value"
              width="20%"
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
              title="User Count"
              width="18%"
              className="centered-table-item"
              render={(record: TableEntry) => {
                const isSharedByAll = record.sharedByCount === this.props.selectedUsers.length;
                const badge = (
                  <Tooltip
                    title={
                      isSharedByAll
                        ? "All selected users have this experience domain."
                        : `Only ${record.sharedByCount} of the selected users ${
                            record.sharedByCount === 1 ? "has" : "have"
                          } this experience domain. Changing the value of the domain will give all selected users this domain.`
                    }
                  >
                    <Badge
                      count={record.sharedByCount}
                      style={isSharedByAll ? { backgroundColor: "var(--ant-success)" } : null}
                    />
                  </Tooltip>
                );

                return <React.Fragment>{badge}</React.Fragment>;
              }}
            />
          ) : null}
          )
          <Column
            title={multipleUsers ? "New Value" : "Value"}
            key="value"
            width={multipleUsers ? "20%" : "40%"}
            render={record => {
              const index = this.state.tableEntries.findIndex(
                entry => entry.domain === record.domain,
              );
              return (
                <span>
                  <InputNumber
                    ref={ref => {
                      if (ref == null || this.state.domainToEdit !== record.domain) {
                        return;
                      }
                      ref.focus();
                      setTimeout(() => {
                        // Unfortunately, the time out is necessary, since otherwise the
                        // focus is not correctly set
                        this.setState({ domainToEdit: null });
                      }, 0);
                    }}
                    value={
                      this.state.tableEntries[index].value > -1
                        ? this.state.tableEntries[index].value
                        : ""
                    }
                    onChange={value => this.setValueOfEntry(index, value)}
                    type="number"
                  />
                  {record.changed ? (
                    <Tooltip placement="top" title="Revert Changes">
                      <RollbackOutlined
                        style={{ marginLeft: 15 }}
                        className="clickable-icon"
                        onClick={() => this.revertChangesOfEntry(index)}
                      />
                    </Tooltip>
                  ) : null}
                </span>
              );
            }}
          />
          <Column
            width={multipleUsers ? "7%" : "20%"}
            render={record => (
              <span>
                <Tooltip placement="top" title="Remove Entry">
                  <DeleteOutlined
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
            These experience domains will be removed from all selected users:
            <br />
            {this.state.removedDomains.map((domain: string) => (
              <Tooltip
                key={domain}
                placement="top"
                title="Click here if you don't want to remove this domain from all selected users."
              >
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
                  {domain} <CloseOutlined />
                </Tag>
              </Tooltip>
            ))}
          </div>
        ) : null}
        <Tooltip
          placement="top"
          title="Select an existing experience domain or create a new one by typing its name in this input field."
        >
          <SelectExperienceDomain
            disabled={false}
            allowCreation
            placeholder="Assign or Create Experience Domain"
            value={[]}
            width={50}
            onSelect={this.addEnteredExperience}
            alreadyUsedDomains={this.getDomainsOfTable()}
          />
        </Tooltip>
      </Modal>
    );
  }
}

export default ExperienceModalView;
