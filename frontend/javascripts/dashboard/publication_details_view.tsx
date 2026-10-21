import { ArrowLeftOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getPublication } from "admin/rest_api";
import { Button, Flex, Layout, Space, Spin, Tooltip, theme } from "antd";
import PublicationCard from "dashboard/publication_card";
import { PublicationsEmptyText } from "dashboard/publication_view";
import { handleGenericError } from "libs/error_handling";
import { useEffect } from "react";
import { Link, useParams } from "react-router";

const { Content } = Layout;

function PublicationDetailView() {
  const { id: publicationId = "" } = useParams();
  const { token } = theme.useToken();

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
        <Flex orientation="vertical" gap="medium" style={{ paddingBottom: token.paddingXL }}>
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
            {publication != null ? (
              <PublicationCard publication={publication} showDetailedLink={false} defaultExpanded />
            ) : (
              !isLoading && (
                <PublicationsEmptyText>
                  Could not find the requested publication.
                </PublicationsEmptyText>
              )
            )}
          </Spin>
        </Flex>
      </Content>
    </Layout>
  );
}

export default PublicationDetailView;
