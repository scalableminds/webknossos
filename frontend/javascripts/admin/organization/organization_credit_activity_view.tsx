import { CalendarOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getCreditTransactions } from "admin/api/organization";
import { getJobTypeName } from "admin/job/job_list_view";
import { Button, DatePicker, Space, Spin, Table, Tag, Typography } from "antd";
import FormattedId from "components/formatted_id";
import FastTooltip from "components/fast_tooltip";
import dayjs from "dayjs";
import { formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useMemo } from "react";
import type { APICreditState, APICreditTransaction, APIJob } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";

const { Column } = Table;

const SYSTEM_USER_LABEL = "System";
const NO_JOB_FILTER_VALUE = "__NO_JOB__";
const NO_JOB_LABEL = "No job";
const dateFilterFormat = "YYYY-MM-DD";

const creditStateColors: Partial<Record<APICreditState, string>> = {
  AddCredits: "green",
  Spent: "red",
  Refunded: "gold",
  Revoked: "volcano",
  PartiallyRevoked: "orange",
  Refunding: "blue",
  Revoking: "purple",
};

function formatCreditDelta(credits: number): string {
  const absoluteCredits = Math.abs(credits);
  const formatted = formatMilliCreditsString(absoluteCredits);
  if (credits > 0) {
    return `+${formatted}`;
  }
  if (credits < 0) {
    return `-${formatted}`;
  }
  return formatted;
}

function getUserLabel(job: APIJob | null | undefined): string {
  if (job == null) {
    return SYSTEM_USER_LABEL;
  }
  return `${job.ownerLastName}, ${job.ownerFirstName}`;
}

function getUserFilterValue(job: APIJob | null | undefined): string {
  if (job == null) {
    return SYSTEM_USER_LABEL;
  }
  return job.ownerEmail;
}

function getUserFilterText(job: APIJob | null | undefined): string {
  if (job == null) {
    return SYSTEM_USER_LABEL;
  }
  return `${job.ownerLastName}, ${job.ownerFirstName} (${job.ownerEmail})`;
}

function renderJob(job: APIJob | null | undefined) {
  if (job == null) {
    return null;
  }
  const datasetLabel = job.args.datasetName || job.args.datasetDirectoryName;
  return (
    <div>
      <div>{getJobTypeName(job.command)}</div>
      {datasetLabel ? <div>{datasetLabel}</div> : null}
      <FormattedId id={job.id} />
    </div>
  );
}

export function OrganizationCreditActivityView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const { data: transactions = [], isLoading } = useQuery({
    queryKey: ["credit-transactions"],
    queryFn: getCreditTransactions,
  });

  const organizationTransactions = useMemo(() => {
    return transactions
      .filter((transaction) => transaction.organization_id === organization.id)
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [transactions, organization.id]);

  const jobFilters = useMemo(() => {
    const options = new Map<string, string>();
    for (const transaction of organizationTransactions) {
      const job = transaction.paidJob;
      if (job == null) {
        options.set(NO_JOB_FILTER_VALUE, NO_JOB_LABEL);
      } else {
        options.set(job.command, getJobTypeName(job.command));
      }
    }
    return Array.from(options.entries()).map(([value, text]) => ({ value, text }));
  }, [organizationTransactions]);

  const userFilters = useMemo(() => {
    const options = new Map<string, string>();
    for (const transaction of organizationTransactions) {
      const job = transaction.paidJob;
      options.set(getUserFilterValue(job), getUserFilterText(job));
    }
    return Array.from(options.entries()).map(([value, text]) => ({ value, text }));
  }, [organizationTransactions]);

  const stateFilters = useMemo(() => {
    const states = new Set<string>();
    for (const transaction of organizationTransactions) {
      states.add(transaction.creditState);
    }
    return Array.from(states)
      .sort()
      .map((state) => ({ text: state, value: state }));
  }, [organizationTransactions]);

  return (
    <>
      <SettingsTitle
        title="Credit Activity"
        description="Review credit purchases, spending, and refunds for your organization."
      />
      <Spin spinning={isLoading}>
        <Table
          dataSource={organizationTransactions}
          rowKey="id"
          pagination={{ defaultPageSize: 50 }}
          locale={{ emptyText: "No credit activity recorded yet." }}
          style={{ marginTop: 16 }}
          summary={(pageData) => {
            const totalCredits = pageData.reduce(
              (sum, transaction) => sum + transaction.creditChange,
              0,
            );
            return (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>Total</Table.Summary.Cell>
                <Table.Summary.Cell index={1}>
                  <Typography.Text>{formatCreditDelta(totalCredits)} credits</Typography.Text>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={2} colSpan={4} />
              </Table.Summary.Row>
            );
          }}
        >
          <Column
            title="Date"
            key="createdAt"
            width={170}
            render={(transaction: APICreditTransaction) => {
              const utcTimestamp = dayjs.utc(transaction.createdAt);
              const localTimestamp = utcTimestamp.local();
              return (
                <FastTooltip
                  title={`The displayed time refers to your local timezone. In UTC, the time is: ${utcTimestamp.format(
                    "YYYY-MM-DD HH:mm",
                  )}`}
                >
                  <div>
                    <div>{localTimestamp.format("YYYY-MM-DD")}</div>
                    <Typography.Text type="secondary">
                      {localTimestamp.format("HH:mm")}
                    </Typography.Text>
                  </div>
                </FastTooltip>
              );
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.createdAt - right.createdAt
            }
            defaultSortOrder="descend"
            filterDropdown={({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => {
              const selectedRange = selectedKeys[0] ? (selectedKeys[0] as string).split("|") : [];
              const startDate =
                selectedRange[0] != null && selectedRange[0] !== ""
                  ? dayjs(selectedRange[0], dateFilterFormat)
                  : null;
              const endDate =
                selectedRange[1] != null && selectedRange[1] !== ""
                  ? dayjs(selectedRange[1], dateFilterFormat)
                  : null;
              return (
                <Space style={{ padding: 8 }}>
                  <DatePicker.RangePicker
                    value={startDate && endDate ? [startDate, endDate] : null}
                    onChange={(dates) => {
                      if (dates == null || dates[0] == null || dates[1] == null) {
                        setSelectedKeys([]);
                        return;
                      }
                      setSelectedKeys([
                        `${dates[0].format(dateFilterFormat)}|${dates[1].format(dateFilterFormat)}`,
                      ]);
                    }}
                    allowClear
                  />
                  <Button type="primary" size="small" onClick={() => confirm()}>
                    Apply
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      clearFilters?.();
                      confirm();
                    }}
                  >
                    Reset
                  </Button>
                </Space>
              );
            }}
            filterIcon={(filtered) => (
              <CalendarOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
            )}
            onFilter={(value, record) => {
              const [startValue, endValue] = (value as string).split("|");
              const startDate = startValue ? dayjs(startValue, dateFilterFormat) : null;
              const endDate = endValue ? dayjs(endValue, dateFilterFormat) : null;
              if (startDate == null || endDate == null) {
                return true;
              }
              const recordDate = dayjs(record.createdAt);
              const isAfterStart =
                recordDate.isSame(startDate, "day") || recordDate.isAfter(startDate, "day");
              const isBeforeEnd =
                recordDate.isSame(endDate, "day") || recordDate.isBefore(endDate, "day");
              return isAfterStart && isBeforeEnd;
            }}
          />
          <Column
            title="Credit Change"
            key="creditChange"
            width={130}
            render={(transaction: APICreditTransaction) => {
              const formattedChange = formatCreditDelta(transaction.creditChange);
              const textType =
                transaction.creditChange < 0
                  ? "danger"
                  : transaction.creditChange > 0
                    ? "success"
                    : undefined;
              return <Typography.Text type={textType}>{formattedChange} credits</Typography.Text>;
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.creditChange - right.creditChange
            }
          />
          <Column
            title="Details"
            dataIndex="comment"
            key="comment"
            width={320}
            render={(comment: string) => (
              <Typography.Text style={{ whiteSpace: "normal" }}>{comment}</Typography.Text>
            )}
          />
          <Column
            title="Job"
            key="paidJob"
            width={200}
            render={(transaction: APICreditTransaction) => renderJob(transaction.paidJob)}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) => {
              const leftLabel = left.paidJob ? getJobTypeName(left.paidJob.command) : "";
              const rightLabel = right.paidJob ? getJobTypeName(right.paidJob.command) : "";
              return leftLabel.localeCompare(rightLabel);
            }}
            filters={jobFilters}
            onFilter={(value, record: APICreditTransaction) => {
              if (value === NO_JOB_FILTER_VALUE) {
                return record.paidJob == null;
              }
              return record.paidJob?.command === value;
            }}
          />
          <Column
            title="User"
            key="user"
            width={200}
            render={(transaction: APICreditTransaction) => {
              const job = transaction.paidJob;
              if (job == null) {
                return SYSTEM_USER_LABEL;
              }
              return (
                <div>
                  <div>{getUserLabel(job)}</div>
                  <Typography.Text type="secondary">({job.ownerEmail})</Typography.Text>
                </div>
              );
            }}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              getUserLabel(left.paidJob).localeCompare(getUserLabel(right.paidJob))
            }
            filters={userFilters}
            onFilter={(value, record: APICreditTransaction) =>
              getUserFilterValue(record.paidJob) === value
            }
          />
          <Column
            title="State"
            key="state"
            width={160}
            render={(transaction: APICreditTransaction) => (
              <>
                <Tag color={creditStateColors[transaction.creditState]}>
                  {transaction.creditState}
                </Tag>
              </>
            )}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.creditState.localeCompare(right.creditState)
            }
            filters={stateFilters}
            onFilter={(value, record: APICreditTransaction) => record.creditState === value}
          />
        </Table>
      </Spin>
    </>
  );
}
