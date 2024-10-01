import { useState } from "react";
import { Modal, Tooltip, Table, InputNumber, Tag, Badge } from "antd";
import { CloseOutlined, DeleteOutlined, RollbackOutlined } from "@ant-design/icons";
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
  domain: string;
  value: number;
  lowestValue: number;
  highestValue: number;
  sharedByCount: number;
  changed: boolean;
};
type Props = {
  onChange: (arg0: APIUser[]) => void;
  onCancel: () => void;
  isOpen: boolean;
  selectedUsers: APIUser[];
  initialDomainToEdit: string | null | undefined;
};

function ExperienceModalView({
  onChange,
  onCancel,
  isOpen,
  selectedUsers,
  initialDomainToEdit,
}: Props) {
  const [tableEntries, setTableEntries] = useState<TableEntry[]>(getTableEntries(selectedUsers));
  const [removedDomains, setRemovedDomains] = useState<string[]>([]);
  const [domainToEdit, setDomainToEdit] = useState<string | null | undefined>(initialDomainToEdit);

  function sortEntries(entries: TableEntry[]): TableEntry[] {
    return entries.sort(Utils.localeCompareBy((entry) => entry.domain.toLowerCase()));
  }

  function getTableEntries(users: APIUser[]): TableEntry[] {
    if (users.length <= 1) {
      return sortEntries(
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
    const allDomains: string[] = _.union(...users.map((user) => Object.keys(user.experiences)));

    // adds the number of users with this domain (sharedByCount) to all domains
    const allDomainsWithCount = allDomains.map((domain) => {
      let sharedByCount = 0;
      users.forEach((user) => {
        if (domain in user.experiences) {
          sharedByCount++;
        }
      });
      return {
        domain,
        sharedByCount,
      };
    });
    // create a table entry for each domain
    const tableEntries = allDomainsWithCount.map((entry) => {
      const usersValues = users.map((user) => user.experiences[entry.domain]);

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
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ domain: string; value: number ... Remove this comment to see the full error message
    return sortEntries(tableEntries);
  }

  async function updateAllUsers() {
    const relevantEntries = tableEntries.filter((entry) => entry.changed);
    const newUserPromises: Array<Promise<APIUser>> = selectedUsers.map((user: APIUser) => {
      const newExperiences = {
        ...user.experiences,
        ..._.fromPairs(relevantEntries.map((entry) => [entry.domain, entry.value])),
      };
      removedDomains.forEach((domain) => {
        if (domain in newExperiences) {
          delete newExperiences[domain];
        }
      });
      const orderedExperiences = {};
      Object.keys(newExperiences)
        .sort(Utils.localeCompareBy((domain) => domain.toLowerCase()))
        .forEach((key) => {
          // @ts-expect-error ts-migrate(7053) FIXME: Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
          orderedExperiences[key] = newExperiences[key];
        });
      const newUser = { ...user, experiences: orderedExperiences };
      return sendUserToServer(newUser, user);
    });
    resolvePromisesAndCloseModal(newUserPromises);
  }

  function sendUserToServer(newUser: APIUser, oldUser: APIUser): Promise<APIUser> {
    return updateUser(newUser).then(
      () => Promise.resolve(newUser),
      () => Promise.reject(oldUser),
    );
  }

  function resolvePromisesAndCloseModal(usersPromises: Array<Promise<APIUser>>): void {
    Promise.all(usersPromises).then(
      (newUsers) => {
        setTableEntries([]);
        onChange(newUsers);
      },
      (error) => {
        handleGenericError(error as Error);
      },
    );
  }

  function setValueOfEntry(index: number, value: number) {
    if (value < 0 || typeof value !== "number") {
      return;
    }

    setTableEntries((tableEntries) => {
      return tableEntries.map((entry, currentIndex) => {
        if (currentIndex !== index) {
          return entry;
        }

        return { ...entry, value, changed: true };
      });
    });
  }

  function revertChangesOfEntry(index: number) {
    setTableEntries(
      tableEntries.map((entry, currentIndex) => {
        if (currentIndex !== index) {
          return entry;
        }

        // only able to revert to a value when in single-user mode and the user already had this domain
        // or when in multiple-user mode and the domain was shared beforehand and all users have the same value
        // -> sharedByCount === count of users and highestValue === lowestValue and highestValue >= 0 -> not -1
        const firstUser = selectedUsers[0];
        const isSingleUserWithEntry =
          selectedUsers.length === 1 && entry.domain in firstUser.experiences;
        const isShared = entry.sharedByCount === selectedUsers.length;
        const isValueSharedAndExistedBefore =
          isShared && entry.lowestValue === entry.highestValue && entry.highestValue >= 0;
        const value =
          isSingleUserWithEntry || isValueSharedAndExistedBefore
            ? firstUser.experiences[entry.domain]
            : -1;
        return { ...entry, value, changed: false };
      }),
    );
  }

  function removeEntryFromTable(domain: string) {
    setTableEntries((tableEntries) => tableEntries.filter((entry) => entry.domain !== domain));
    setRemovedDomains([...removedDomains, domain]);
  }

  function addEnteredExperience(domain: string) {
    if (domain.length < 3) {
      Toast.warning("An experience domain needs at least 3 letters.");
      return;
    }

    if (tableEntries.findIndex((entry) => entry.domain === domain) > -1) {
      return;
    }

    // a newly entered domain is owned by everyone but has invalid lowest and highest values
    const newExperience: TableEntry = {
      domain,
      value: -1,
      lowestValue: -1,
      highestValue: -1,
      sharedByCount: selectedUsers.length,
      changed: false,
    };

    setTableEntries((tableEntries) => sortEntries([...tableEntries, newExperience]));
    setRemovedDomains((removedDomains) =>
      removedDomains.filter((currentDomain) => currentDomain !== domain),
    );
    setDomainToEdit(domain);
  }

  function getDomainsOfTable(): ExperienceDomainList {
    return tableEntries.map((entry) => entry.domain);
  }

  const selectedUsersCount = selectedUsers.length;

  if (!isOpen && selectedUsersCount === 0) {
    return null;
  }

  const multipleUsers = selectedUsersCount > 1;
  return (
    <Modal
      className="experience-change-modal"
      title={
        multipleUsers
          ? `Change Experiences of ${selectedUsersCount} Users`
          : `Change Experiences for ${selectedUsers[0].firstName} ${selectedUsers[0].lastName}`
      }
      open={isOpen}
      onCancel={onCancel}
      onOk={updateAllUsers}
      okText={"Save"}
      width={multipleUsers ? 800 : 600}
      maskClosable={false}
    >
      <Table
        size="small"
        dataSource={tableEntries}
        rowKey="domain"
        pagination={false}
        scroll={{
          y: 350,
        }}
        className="user-experience-table"
        components={{
          body: {
            row: HighlightableRow,
          },
        }}
        // @ts-expect-error ts-migrate(2322) FIXME: Type '(record: TableEntry) => { shouldHighlight: b... Remove this comment to see the full error message
        onRow={(record) => ({
          shouldHighlight: record.domain === domainToEdit,
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
              const isSharedByAll = record.sharedByCount === selectedUsers.length;
              return (
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
                    style={
                      isSharedByAll
                        ? {
                            backgroundColor: "var(--ant-color-success)",
                          }
                        : undefined
                    }
                  />
                </Tooltip>
              );
            }}
          />
        ) : null}
        )
        <Column
          title={multipleUsers ? "New Value" : "Value"}
          key="value"
          width={multipleUsers ? "20%" : "40%"}
          render={(record) => {
            const index = tableEntries.findIndex((entry) => entry.domain === record.domain);
            return (
              <span>
                <InputNumber
                  ref={(ref) => {
                    if (ref == null || domainToEdit !== record.domain) {
                      return;
                    }

                    ref.focus();
                    setTimeout(() => {
                      // Unfortunately, the time out is necessary, since otherwise the
                      // focus is not correctly set
                      setDomainToEdit(null);
                    }, 0);
                  }}
                  value={tableEntries[index].value > -1 ? tableEntries[index].value : ""}
                  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'number | ""' is not assignable t... Remove this comment to see the full error message
                  onChange={(value) => setValueOfEntry(index, value)}
                  type="number"
                />
                {record.changed ? (
                  <Tooltip placement="top" title="Revert Changes">
                    <RollbackOutlined
                      style={{
                        marginLeft: 15,
                      }}
                      className="clickable-icon"
                      onClick={() => revertChangesOfEntry(index)}
                    />
                  </Tooltip>
                ) : null}
              </span>
            );
          }}
        />
        <Column
          width={multipleUsers ? "7%" : "20%"}
          render={(record) => (
            <span>
              <Tooltip placement="top" title="Remove Entry">
                <DeleteOutlined
                  className="clickable-icon"
                  onClick={() => removeEntryFromTable(record.domain)}
                />
              </Tooltip>
            </span>
          )}
        />
      </Table>
      {multipleUsers && removedDomains.length > 0 ? (
        <div
          style={{
            marginBottom: 24,
          }}
        >
          These experience domains will be removed from all selected users:
          <br />
          {removedDomains.map((domain: string) => (
            <Tooltip
              key={domain}
              placement="top"
              title="Click here if you don't want to remove this domain from all selected users."
            >
              <Tag
                style={{
                  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ magin: number; marginTop: number; }' is no... Remove this comment to see the full error message
                  magin: 8,
                  marginTop: 10,
                }}
                className="clickable-icon"
                onClick={() => {
                  setRemovedDomains(
                    removedDomains.filter((currentDomain) => currentDomain !== domain),
                  );
                }}
              >
                {domain} <CloseOutlined />
              </Tag>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <SelectExperienceDomain
        disabled={false}
        allowCreation
        placeholder="Assign or Create Experience Domain"
        value={[]}
        width={50}
        onSelect={addEnteredExperience}
        alreadyUsedDomains={getDomainsOfTable()}
      />
    </Modal>
  );
}

export default ExperienceModalView;
