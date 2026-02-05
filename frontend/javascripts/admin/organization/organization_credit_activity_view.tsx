import { SettingsTitle } from "admin/account/helpers/settings_title";
import { getCreditTransactions } from "admin/api/organization";
import { Spin, Table, Tag, Typography } from "antd";
import FormattedDate from "components/formatted_date";
import FormattedId from "components/formatted_id";
import { formatMilliCreditsString } from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useMemo, useState } from "react";
import type { APICreditState, APICreditTransaction, APIJob } from "types/api_types";
import { enforceActiveOrganization } from "viewer/model/accessors/organization_accessors";

const { Column } = Table;

const creditStateColors: Partial<Record<APICreditState, string>> = {
  AddCredits: "green",
  Spent: "red",
  Refunded: "gold",
  Revoked: "volcano",
  PartiallyRevoked: "orange",
  Refunding: "blue",
  Revoking: "purple",
};

const transactionStateColors: Partial<Record<APICreditTransaction["transactionState"], string>> = {
  Pending: "gold",
  Complete: "green",
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

function renderJob(job: APIJob | null | undefined) {
  if (job == null) {
    return "-";
  }
  const datasetLabel = job.args.datasetName || job.args.datasetDirectoryName;
  return (
    <div>
      <div>{job.command}</div>
      {datasetLabel ? <div>{datasetLabel}</div> : null}
      <FormattedId id={job.id} />
    </div>
  );
}

export function OrganizationCreditActivityView() {
  const organization = useWkSelector((state) =>
    enforceActiveOrganization(state.activeOrganization),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [transactions, setTransactions] = useState<Array<APICreditTransaction>>([]);

  useEffect(() => {
    let isMounted = true;

    async function fetchData() {
      setIsLoading(true);
      try {
        const creditTransactions = await getCreditTransactions();
        if (!isMounted) {
          return;
        }
        setTransactions(creditTransactions);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    fetchData();
    return () => {
      isMounted = false;
    };
  }, [organization.id]);

  const organizationTransactions = useMemo(() => {
    return transactions
      .filter((transaction) => transaction.organization_id === organization.id)
      .slice()
      .sort((left, right) => right.createdAt - left.createdAt);
  }, [transactions, organization.id]);

  return (
    <>
      <SettingsTitle
        title="Activity Log"
        description="Review credit purchases, spending, and refunds for your organization."
      />
      <Spin spinning={isLoading}>
        <Table
          dataSource={organizationTransactions}
          rowKey="id"
          pagination={{ defaultPageSize: 50 }}
          locale={{ emptyText: "No credit activity recorded yet." }}
          style={{ marginTop: 16 }}
        >
          <Column
            title="Date"
            key="createdAt"
            width={170}
            render={(transaction: APICreditTransaction) => (
              <FormattedDate timestamp={transaction.createdAt} />
            )}
            sorter={(left: APICreditTransaction, right: APICreditTransaction) =>
              left.createdAt - right.createdAt
            }
            defaultSortOrder="descend"
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
              return (
                <Typography.Text type={textType}>
                  {formattedChange} credits
                </Typography.Text>
              );
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
            ellipsis
            render={(comment: string) => (
              <Typography.Text ellipsis={{ tooltip: comment }}>{comment}</Typography.Text>
            )}
          />
          <Column
            title="Job"
            key="paidJob"
            width={200}
            render={(transaction: APICreditTransaction) => renderJob(transaction.paidJob)}
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
                <Tag color={transactionStateColors[transaction.transactionState]}>
                  {transaction.transactionState}
                </Tag>
              </>
            )}
          />
        </Table>
      </Spin>
    </>
  );
}
