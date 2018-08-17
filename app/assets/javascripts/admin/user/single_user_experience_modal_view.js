// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Input, Icon, Table, InputNumber } from "antd";
import update from "immutability-helper";
import { updateUser } from "admin/admin_rest_api";
import type { APIUserType } from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";

const { Column } = Table;

type TableEntry = {
  domain: string,
  value: int,
  removed: boolean,
};

type Props = {
  onClose: Function,
  onCancel: Function,
  visible: boolean,
  selectedUser: APIUserType,
};

type State = {
  experienceEntries: Array<TableEntry>,
  // use an array to save change stuff and before commit change ask with another modal
};

class SingleUserExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    const experiences = this.props.selectedUser.experiences;
    const tableData = [];
    _.map(experiences, (value, domain) => {
      tableData.push({ domain, value, removed: false });
    });
    this.state = { experienceEntries: tableData };
  }

  updateUsersExperiences = async () => {
    const notRemovedExperiences = this.state.experienceEntries.filter(entry => !entry.removed);
    const formatedExperiences = {};
    notRemovedExperiences.forEach(experience => {
      formatedExperiences[experience.domain] = experience.value;
    });
    const updatedUser = { ...this.props.selectedUser, experiences: formatedExperiences };
    try {
      await updateUser(updatedUser);
    } catch (error) {
      handleGenericError(error);
    } finally {
      this.props.onClose();
    }
  };

  sendUserToServer(newUser: APIUserType, oldUser: APIUserType): Promise<APIUserType> {
    return updateUser(newUser).then(() => Promise.resolve(newUser), () => Promise.reject(oldUser));
  }

  validateEntry(entry: TableEntry): boolean {
    return entry.removed || (entry.domain.length > 2 && entry.value > 0);
  }

  validateDomainAndValues(tableData: []) {
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid) isValid = this.validateEntry(entry);
    });
    return isValid;
  }

  recordModified = (record): boolean =>
    record.value === this.props.selectedUser.experiences[record.domain];

  render() {
    if (!this.props.visible) {
      return null;
    }
    const tableData = this.state.experienceEntries;
    const isValid = this.validateDomainAndValues(tableData);
    const pagination = tableData > 10 ? { pageSize: 10 } : false;
    return (
      <Modal
        className="experience-change-modal"
        title={`Change Experiences of user ${this.props.selectedUser.lastName}, ${
          this.props.selectedUser.firstName
        }`}
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        width={800}
        footer={
          <div>
            <Button type="primary" onClick={this.updateUsersExperiences} disabled={!isValid}>
              Update Experience
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Table
          dataSource={tableData}
          rowKey="domain"
          pagination={pagination}
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
            render={record => {
              const index = this.state.experienceEntries.findIndex(
                entry => entry.domain === record.domain,
              );
              return (
                <span>
                  <Icon
                    type="minus"
                    className={
                      record.removed
                        ? "clickable-icon disabled-icon"
                        : "clickable-icon active-icon hoverable-icon"
                    }
                    onClick={
                      record.removed
                        ? null
                        : () => {
                            const alteredEntries = this.state.experienceEntries.map(
                              (entry, currentIndex) => {
                                if (currentIndex === index && entry.value > 1) {
                                  return {
                                    ...entry,
                                    value: entry.value - 1,
                                  };
                                } else {
                                  return entry;
                                }
                              },
                            );
                            this.setState({ experienceEntries: alteredEntries });
                          }
                    }
                  />
                  <InputNumber
                    min={1}
                    disabled={record.removed}
                    value={this.state.experienceEntries[index].value}
                    onChange={value => {
                      if (value > 0) {
                        const alteredEntries = this.state.experienceEntries.map(
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
                        );
                        this.setState({ experienceEntries: alteredEntries });
                      }
                    }}
                  />
                  <Icon
                    type="plus"
                    className={
                      record.removed
                        ? "clickable-icon disabled-icon"
                        : "clickable-icon active-icon hoverable-icon"
                    }
                    style={{ marginLeft: 5 }}
                    onClick={
                      record.removed
                        ? null
                        : () => {
                            const alteredEntries = this.state.experienceEntries.map(
                              (entry, currentIndex) => {
                                if (currentIndex === index && entry.value > 1) {
                                  return {
                                    ...entry,
                                    value: entry.value + 1,
                                  };
                                } else {
                                  return entry;
                                }
                              },
                            );
                            this.setState({ experienceEntries: alteredEntries });
                          }
                    }
                  />
                  {this.recordModified(record) ? (
                    <Icon style={{ marginLeft: 21, color: "rgba(0, 0, 0, 0)" }} type="rollback" />
                  ) : (
                    <Tooltip placement="top" title="Revert Changes">
                      <Icon
                        style={
                          record.removed
                            ? { marginLeft: 15, color: "rgba(0, 0, 0, 0.25)" }
                            : { marginLeft: 15 }
                        }
                        className="hoverable-icon clickable-icon"
                        type="rollback"
                        onClick={
                          record.removed
                            ? null
                            : () => {
                                const alteredEntries = this.state.experienceEntries.map(
                                  (entry, currentIndex) => {
                                    if (currentIndex === index) {
                                      return {
                                        ...entry,
                                        value: this.props.selectedUser.experiences[record.domain],
                                      };
                                    } else {
                                      return entry;
                                    }
                                  },
                                );
                                this.setState({ experienceEntries: alteredEntries });
                              }
                        }
                      />
                    </Tooltip>
                  )}
                </span>
              );
            }}
          />
          <Column
            title="Delete Entry"
            key="removed"
            render={record => {
              const index = this.state.experienceEntries.findIndex(
                entry => entry.domain === record.domain,
              );
              return (
                <span>
                  {record.removed ? (
                    <Tooltip placement="top" title="Undo">
                      <Icon
                        type="close-circle-o"
                        onClick={() => {
                          const alteredEntries = this.state.experienceEntries.map(
                            (entry, currentIndex) => {
                              if (currentIndex === index && entry.value > 1) {
                                return {
                                  ...entry,
                                  removed: false,
                                };
                              } else {
                                return entry;
                              }
                            },
                          );
                          this.setState({ experienceEntries: alteredEntries });
                        }}
                      />
                    </Tooltip>
                  ) : (
                    <Tooltip placement="top" title="Delete this Domain">
                      <Icon
                        type="delete"
                        onClick={() => {
                          const alteredEntries = this.state.experienceEntries.map(
                            (entry, currentIndex) => {
                              if (currentIndex === index && entry.value > 1) {
                                return {
                                  ...entry,
                                  removed: true,
                                };
                              } else {
                                return entry;
                              }
                            },
                          );
                          this.setState({ experienceEntries: alteredEntries });
                        }}
                      />
                    </Tooltip>
                  )}
                </span>
              );
            }}
          />
        </Table>
      </Modal>
    );
  }
}

export default SingleUserExperienceModalView;
