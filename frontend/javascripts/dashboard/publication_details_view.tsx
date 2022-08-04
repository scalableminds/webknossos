import React, { useState, useEffect } from "react";
import { Layout, Spin, Tooltip } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { getPublication } from "admin/admin_rest_api";
import type { APIPublication } from "types/api_flow_types";
import PublicationCard from "dashboard/publication_card";
import { handleGenericError } from "libs/error_handling";
import { Link } from "react-router-dom";
const { Content } = Layout;

export function SimpleHeader() {
  return (
    <div id="oxalis-header">
      <img
        src="/assets/images/oxalis.svg"
        alt="webKnossos Logo"
        style={{
          verticalAlign: "middle",
        }}
      />
      webKnossos
    </div>
  );
}

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
      <SimpleHeader />
      <Content className="centered-content">
        <Spin size="large" spinning={isLoading}>
          {publication != null && (
            <React.Fragment>
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
              <PublicationCard publication={publication} showDetailedLink={false} />
            </React.Fragment>
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
