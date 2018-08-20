// @flow

import _ from "lodash";
import * as React from "react";
import { Modal, Button, Tooltip, Icon } from "antd";
import Toast from "libs/toast";
import { updateUser } from "admin/admin_rest_api";
import type { APIUserType, ExperienceDomainListType } from "admin/api_flow_types";
import { handleGenericError } from "libs/error_handling";
import SelectExperienceDomain from "components/select_experience_domain";
import ExperienceEditingTable, { ExperienceTableEntry } from "admin/user/experience_editing_table";

type Props = {
  onClose: Function,
  onCancel: Function,
  visible: boolean,
  selectedUser: APIUserType,
};

type State = {
  experienceEntries: Array<ExperienceTableEntry>,
  enteredExperience: Array<string>,
};

class SingleUserExperienceModalView extends React.PureComponent<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { experienceEntries: this.loadTableEntries(), enteredExperience: [] };
  }

  componentWillReceiveProps(nextProps: Props) {
    if (nextProps.visible && !this.props.visible) {
      this.setState({ experienceEntries: this.loadTableEntries(), enteredExperience: [] });
    }
  }

  loadTableEntries = (): Array<ExperienceTableEntry> =>
    _.sortBy(
      _.map(this.props.selectedUser.experiences, (value, domain) => ({
        domain,
        value,
        removed: false,
      })),
      entry => entry.domain,
    );

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

  validateEntry(entry: ExperienceTableEntry): boolean {
    return entry.removed || (entry.domain.length > 2 && entry.value > 0);
  }

  validateDomainAndValues(tableData: Array<ExperienceTableEntry>) {
    let isValid = true;
    tableData.forEach(entry => {
      if (isValid) isValid = this.validateEntry(entry);
    });
    return isValid;
  }

  recordModifiedAndExistedBefore = (record: ExperienceTableEntry): boolean =>
    record.value !== this.props.selectedUser.experiences[record.domain] &&
    record.domain in this.props.selectedUser.experiences;

  setValueOfEntry = (index: number, value: number) => {
    if (value > 0) {
      this.setState(prevState => ({
        experienceEntries: prevState.experienceEntries.map((entry, currentIndex) => {
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
    this.setState(prevState => ({
      experienceEntries: prevState.experienceEntries.map((entry, currentIndex) => {
        if (currentIndex === index) {
          return {
            ...entry,
            value: this.props.selectedUser.experiences[entry.domain],
          };
        } else {
          return entry;
        }
      }),
    }));
  };

  setRemoveOfEntryTo = (index: number, removed: boolean) => {
    this.setState(prevState => ({
      experienceEntries: prevState.experienceEntries.map((entry, currentIndex) => {
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
    if (!this.state.experienceEntries.find(entry => entry.domain === domain)) {
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

  addEnteredExperiences = () => {
    const newExperiences = this.state.enteredExperience.map(entry => ({
      domain: entry,
      value: 1,
      removed: false,
    }));
    this.setState(prevState => ({
      experienceEntries: _.sortBy(
        _.concat(prevState.experienceEntries, newExperiences),
        entry => entry.domain,
      ),
      enteredExperience: [],
    }));
  };

  getDomainsOfTable = (): ExperienceDomainListType =>
    this.state.experienceEntries.map(entry => entry.domain);

  render() {
    if (!this.props.visible) {
      return null;
    }
    const tableData = this.state.experienceEntries;
    const isValid = this.validateDomainAndValues(tableData);
    return (
      <Modal
        className="experience-change-modal"
        title={`Change Experiences of user ${this.props.selectedUser.lastName}, ${
          this.props.selectedUser.firstName
        }`}
        visible={this.props.visible}
        onCancel={this.props.onCancel}
        width={800}
        maskClosable={false}
        footer={
          <div>
            <Button type="primary" onClick={this.updateUsersExperiences} disabled={!isValid}>
              Submit Changes
            </Button>
            <Button onClick={() => this.props.onCancel()}>Cancel</Button>
          </div>
        }
      >
        <ExperienceEditingTable
          tableData={tableData}
          isMultipleUsersEditing={false}
          setValueOfEntry={this.setValueOfEntry}
          recordModifiedAndExistedBefore={this.recordModifiedAndExistedBefore}
          revertChangesOfEntry={this.revertChangesOfEntry}
          setRemoveOfEntryTo={this.setRemoveOfEntryTo}
          removeEntryFromTable={() => {}}
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
            disabled={!this.state.enteredExperience || this.state.enteredExperience.length <= 0}
            onClick={this.addEnteredExperiences}
          >
            {this.state.enteredExperience.length === 0 ? "Add Experience" : "Add Experiences"}
          </Button>
        </span>
      </Modal>
    );
  }
}

export default SingleUserExperienceModalView;
