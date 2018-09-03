// @flow

import * as React from "react";
import { Tooltip, Icon, Table, InputNumber } from "antd";

const { Column } = Table;

export type EditTableEntry = {
  domain: string,
  value: number,
  removed: boolean,
};

type Props = {
  title: ?string,
  tableData: Array<EditTableEntry>,
  isMultipleUsersEditing: boolean,
  setValueOfEntry: (number, number) => void,
  recordModifiedAndExistedBefore: (record: EditTableEntry) => boolean,
  revertChangesOfEntry: number => void,
  setRemoveOfEntryTo: (number, boolean) => void,
  removeEntryFromTable: number => void,
};

const ExperienceEditingTable = ({
  title,
  tableData,
  isMultipleUsersEditing,
  setValueOfEntry,
  recordModifiedAndExistedBefore,
  revertChangesOfEntry,
  setRemoveOfEntryTo,
  removeEntryFromTable,
}: Props) => {
  const scroll = { y: isMultipleUsersEditing ? 150 : 325 };
  return (
    <Table
      title={() => title}
      size="small"
      dataSource={tableData}
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
          const index = tableData.findIndex(entry => entry.domain === record.domain);
          return (
            <span>
              <InputNumber
                disabled={record.removed}
                value={tableData[index].value}
                onChange={value => setValueOfEntry(index, value)}
              />
              {!isMultipleUsersEditing && recordModifiedAndExistedBefore(record) ? (
                <Tooltip placement="top" title="Revert Changes">
                  <Icon
                    style={{ marginLeft: 15 }}
                    className={record.removed ? "disabled-clickable-icon" : "clickable-icon"}
                    type="rollback"
                    onClick={record.removed ? null : () => revertChangesOfEntry(index)}
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
          const index = tableData.findIndex(entry => entry.domain === record.domain);
          return (
            <span>
              {record.removed ? (
                <Tooltip placement="top" title="Undo">
                  <Icon
                    type="rollback"
                    className="clickable-icon"
                    onClick={() => setRemoveOfEntryTo(index, false)}
                  />
                </Tooltip>
              ) : (
                <Tooltip placement="top" title="Delete this Domain">
                  <Icon
                    type="delete"
                    className="clickable-icon"
                    onClick={() => setRemoveOfEntryTo(index, true)}
                  />
                </Tooltip>
              )}
            </span>
          );
        }}
      />
      {isMultipleUsersEditing ? (
        <Column
          width="10%"
          render={record => {
            const index = tableData.findIndex(entry => entry.domain === record.domain);
            return (
              <Tooltip placement="top" title="Remove Entry">
                <Icon
                  type="close"
                  className="clickable-icon"
                  onClick={() => removeEntryFromTable(index)}
                />
              </Tooltip>
            );
          }}
        />
      ) : null}
    </Table>
  );
};

export default ExperienceEditingTable;
