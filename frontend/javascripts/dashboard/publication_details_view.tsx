import { ArrowLeftOutlined } from "@ant-design/icons";
import { getPublication } from "admin/admin_rest_api";
import { Layout, Spin, Tooltip } from "antd";
import PublicationCard from "dashboard/publication_card";
import { handleGenericError } from "libs/error_handling";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { APIPublication } from "types/api_types";
const { Content } = Layout;

function PublicationDetailView({ publicationId }: { publicationId: string }) {
  const [publication, setPublication] = useState<APIPublication | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setIsLoading(true);
        setPublication(await getPublication(publicationId));
      } catch (error) {
        handleGenericError(error as Error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [publicationId]);

  return (
    <Layout>
      <Content className="centered-content" style={{ marginTop: "4em" }}>
        <Spin size="large" spinning={isLoading}>
          {publication != null && (
            <>
              <Link to="/">
                <Tooltip title="Back to the frontpage.">
                  <ArrowLeftOutlined
                    style={{
                      fontSize: 24,
                      color: "#555",
                      marginBottom: 18,
                    }}
                  />
                  <div
                    style={{
                      display: "inline-block",
                      verticalAlign: "top",
                    }}
                  >
                    Back
                  </div>
                </Tooltip>
              </Link>
              <h3>Featured Publication</h3>
              <PublicationCard publication={publication} showDetailedLink={false} />
            </>
          )}
          {!isLoading && publication == null && (
            <p
              style={{
                textAlign: "center",
              }}
            >
              Could not find the requested publication.
            </p>
          )}
        </Spin>
      </Content>
    </Layout>
  );
}

export default PublicationDetailView;
