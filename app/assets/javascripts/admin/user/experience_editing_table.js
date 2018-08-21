// @flow

import * as React from "react";
import { Tooltip, Icon, Table, InputNumber } from "antd";

const { Column } = Table;

export type ExperienceTableEntry = {
  domain: string,
  value: number,
  removed: boolean,
};

type Props = {
  title: ?string,
  tableData: Array<ExperienceTableEntry>,
  isMultipleUsersEditing: boolean,
  setValueOfEntry: (number, number) => void,
  recordModifiedAndExistedBefore: (record: ExperienceTableEntry) => boolean,
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
}: Props) => (
  <Table
    title={() => title}
    size={tableData.length > 4 ? "small" : "default"}
    dataSource={tableData}
    rowKey="domain"
    pagination={false}
    scroll={tableData.length > 4 ? { y: 250 } : {}}
    className="user-experience-table"
  >
    <Column
      title="Experience Domain"
      key="domain"
      width={isMultipleUsersEditing ? "30%" : "35%"}
      render={record =>
        record.removed ? <div className="disabled">{record.domain}</div> : record.domain
      }
    />
    <Column
      title="Experience Value"
      key="value"
      width={isMultipleUsersEditing ? "40%" : "45%"}
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
                  style={
                    record.removed
                      ? {
                          marginLeft: 15,
                          color: "rgba(0, 0, 0, 0.25)",
                        }
                      : { marginLeft: 15 }
                  }
                  className={
                    record.removed ? "disabled-clickable-icon" : "hoverable-icon clickable-icon"
                  }
                  type="rollback"
                  onClick={record.removed ? null : () => revertChangesOfEntry(index)}
                />
              </Tooltip>
            ) : (
              <Icon style={{ marginLeft: 21 }} className="invisible-icon" type="rollback" />
            )}
          </span>
        );
      }}
    />
    <Column
      title="Delete Entry"
      key="removed"
      width="20%"
      render={record => {
        const index = tableData.findIndex(entry => entry.domain === record.domain);
        return (
          <span>
            {record.removed ? (
              <Tooltip placement="top" title="Undo">
                <Icon type="rollback" onClick={() => setRemoveOfEntryTo(index, false)} />
              </Tooltip>
            ) : (
              <Tooltip placement="top" title="Delete this Domain">
                <Icon type="delete" onClick={() => setRemoveOfEntryTo(index, true)} />
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
              <Icon type="rollback" onClick={() => removeEntryFromTable(index)} />
            </Tooltip>
          );
        }}
      />
    ) : null}
  </Table>
);

export default ExperienceEditingTable;
