import { ArrowLeftOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getPublication } from "admin/rest_api";
import { Button, Flex, Layout, List, Space, Spin, Tooltip } from "antd";
import PublicationCard from "dashboard/publication_card";
import { handleGenericError } from "libs/error_handling";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

const { Content } = Layout;

function PublicationDetailView() {
  const { id: publicationId = "" } = useParams();

  const {
    data: publication = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["publication", publicationId],
    queryFn: () => getPublication(publicationId),
    refetchOnWindowFocus: false,
    enabled: publicationId !== "",
  });

  useEffect(() => {
    if (error) {
      handleGenericError(error as Error);
    }
  }, [error]);

  return (
    <Layout className="container">
      <Content style={{ marginTop: "4em" }}>
        <Flex orientation="vertical" gap="medium">
          <Space>
            <Link to="/">
              <Tooltip title="Back to the frontpage.">
                <Button type="link" icon={<ArrowLeftOutlined />}>
                  Back
                </Button>
              </Tooltip>
            </Link>
          </Space>
          <Spin size="large" spinning={isLoading}>
            <List
              dataSource={publication ? [publication] : []}
              locale={{
                emptyText: "Could not find the requested publication.",
              }}
              className="antd-no-border-list publication-list"
              renderItem={(publicationItem) => (
                <List.Item key={publicationItem.id}>
                  <PublicationCard publication={publicationItem} showDetailedLink={false} />
                </List.Item>
              )}
            />
          </Spin>
        </Flex>
      </Content>
    </Layout>
  );
}

export default PublicationDetailView;
