import { Button, Table, type TableProps } from "antd";
import type { ColumnsType, ExpandableConfig, GetRowKey } from "antd/lib/table/interface";
import type React from "react";
import { useEffect, useState } from "react";

/** This is a wrapper for large tables that have fixed columns and support expanded rows.
 *  This wrapper ensures that when rows are expanded no column is fixed as this creates rendering bugs.
 *  If you are using this wrapper, you do not need to set the class "large-table"
 *  and the scroll prop as this is already done by the wrapper.
 */

// Enforce the "columns" prop which is optional by default otherwise
type OwnTableProps<RecordType = any> = TableProps<RecordType> & {
  columns: ColumnsType<RecordType>;
};

const EMPTY_ARRAY: React.Key[] = [] as const;

const getAllRowIds = (
  dataSource: readonly any[] | undefined,
  rowKey: string | number | symbol | GetRowKey<any> | undefined,
) => {
  const canUseRowKey = typeof rowKey === "string";
  return dataSource != null && canUseRowKey ? dataSource.map((row) => row[rowKey]) : [];
};

export default function FixedExpandableTable<RecordType>({
  className,
  expandable,
  dataSource,
  rowKey,
  columns,
  ...restProps
}: OwnTableProps<RecordType>) {
  const [expandedRows, setExpandedRows] = useState<React.Key[]>(EMPTY_ARRAY);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Collapse all rows when source changes
  useEffect(() => {
    setExpandedRows(EMPTY_ARRAY);
  }, [dataSource]);

  const areAllRowsExpanded = dataSource != null && expandedRows.length === dataSource?.length;

  const columnTitleCollapsed = (
    <Button
      className="ant-table-row-expand-icon ant-table-row-expand-icon-collapsed"
      title="Expand all rows"
      onClick={() => setExpandedRows(getAllRowIds(dataSource, rowKey))}
    />
  );
  const columnTitleExpanded = (
    <Button
      className="ant-table-row-expand-icon ant-table-row-expand-icon-expanded"
      title="Collapse all rows"
      onClick={() => setExpandedRows(EMPTY_ARRAY)}
    />
  );

  const columnsWithAdjustedFixedProp = columns.map((column) => {
    const columnFixed = expandedRows.length > 0 ? false : column.fixed;
    return { ...column, fixed: columnFixed };
  });

  const expandableProp: ExpandableConfig<RecordType> = {
    ...expandable,
    expandedRowKeys: expandedRows,
    onExpandedRowsChange: (selectedRows: readonly React.Key[]) => {
      setExpandedRows(selectedRows as React.Key[]);
    },
    columnTitle: areAllRowsExpanded ? columnTitleExpanded : columnTitleCollapsed,
  };

  return (
    <Table
      {...restProps}
      dataSource={dataSource}
      rowKey={rowKey}
      expandable={expandableProp}
      scroll={{
        x: "max-content",
      }}
      className={`large-table ${className}`}
      columns={columnsWithAdjustedFixedProp}
    />
  );
}
