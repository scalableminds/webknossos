// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon, Table } from "antd";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import { updateUser } from "admin/admin_rest_api";
import { handleGenericError } from "libs/error_handling";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import SelectExperienceDomain from "components/select_experience_domain";
import ExperienceEditingTable from "admin/user/experience_editing_table";
import type { ExperienceTableEntry } from "admin/user/experience_editing_table";

const { Column } = Table;

type SharedTableEntry = {
  domain: string,
  value: number,
  lowestValue: number,
  highestValue: number,
};

type Props = {
  onChange: (Array<APIUserType>) => void,
  onCancel: () => void,
  visible: boolean,
  selectedUsers: Array<APIUserType>,
};

type State = {
  sharedExperiencesEntries: Array<SharedTableEntry>,
  changeEntries: Array<ExperienceTableEntry>,
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
    return entries.sort(
      Utils.localeCompareBy(([]: Array<SharedTableEntry>), entry => entry.domain.toLowerCase()),
    );
  };

  updateUsersExperiences = async () => {
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
      error => {
        handleGenericError(error);
      },
    );
  }

  validateEntry(entry: ExperienceTableEntry): boolean {
    return entry.removed || entry.domain.length > 2;
  }

  validateDomainAndValues(tableData: Array<ExperienceTableEntry>) {
    if (tableData.length <= 0) return false;
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid) isValid = this.validateEntry(entry);
    });
    return isValid;
  }

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
    const newExperiences = this.state.enteredExperience.map(entry => {
      if (
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
        Utils.localeCompareBy(([]: Array<ExperienceTableEntry>), entry =>
          entry.domain.toLowerCase(),
        ),
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
    return (
      <Modal
        className="experience-change-modal"
        title="Change Experiences of Multiple Users"
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        maskClosable={false}
        width={800}
        footer={
          <div>
            <Button type="primary" onClick={this.updateUsersExperiences} disabled={!isValid}>
              Submit Changes
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <Table
          title={() => "Shared Experience Domains"}
          size={sharedExperiencesEntries.length > 3 ? "small" : "default"}
          dataSource={sharedExperiencesEntries}
          rowKey="domain"
          pagination={false}
          scroll={sharedExperiencesEntries.length > 3 ? { y: 150 } : {}}
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
        <ExperienceEditingTable
          title="Changes"
          tableData={changeEntries}
          isMultipleUsersEditing
          setValueOfEntry={this.setValueOfEntry}
          recordModifiedAndExistedBefore={() => false}
          revertChangesOfEntry={() => {}}
          setRemoveOfEntryTo={this.setRemoveOfEntryTo}
          removeEntryFromTable={this.removeEntryFromTable}
        />
        <span>
          <SelectExperienceDomain
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
