import { HourglassOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { getUnfinishedUploads, type UnfinishedUpload } from "admin/rest_api";
import { Alert, Button, Col, Row, Tooltip } from "antd";
import { useQueryWithErrorHandling } from "libs/react_hooks";

/** Uploads from the past two weeks that were started by the user but not completed. */
export function useUnfinishedUploads(
  datastoreUrl: string | undefined,
  organizationId: string | undefined,
): UnfinishedUpload[] {
  const { data } = useQueryWithErrorHandling({
    queryKey: ["unfinishedUploads", datastoreUrl, organizationId],
    queryFn: async () => {
      if (datastoreUrl == null || organizationId == null) return [];
      const unfinishedUploads = await getUnfinishedUploads(datastoreUrl, organizationId);
      // Sort so that most-recent uploads come first
      return unfinishedUploads.sort((a, b) => b.created - a.created);
    },
    enabled: datastoreUrl != null && organizationId != null,
  });
  return data ?? [];
}

export function UnfinishedUploadsAlert({
  unfinishedUploads,
  onContinue,
}: {
  unfinishedUploads: UnfinishedUpload[];
  onContinue: (unfinishedUpload: UnfinishedUpload) => void;
}) {
  if (unfinishedUploads.length === 0) return null;
  return (
    <Alert
      title={
        <>
          Unfinished Dataset Uploads{" "}
          <Tooltip
            title="This list shows all uploads from the past two weeks that were started by you but not completed. You can try continuing these uploads."
            placement="right"
          >
            <InfoCircleOutlined />
          </Tooltip>
        </>
      }
      description={
        <div style={{ paddingTop: 8 }}>
          {unfinishedUploads.map((unfinishedUpload) => (
            <Row key={unfinishedUpload.uploadId} gutter={16}>
              <Col span={8}>{unfinishedUpload.datasetName}</Col>
              <Col span={8}>
                <Button type="link" onClick={() => onContinue(unfinishedUpload)}>
                  Continue upload
                </Button>
              </Col>
            </Row>
          ))}
        </div>
      }
      type="info"
      style={{ marginBottom: 24 }}
      showIcon
      icon={<HourglassOutlined />}
    />
  );
}
