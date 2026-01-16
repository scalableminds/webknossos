import { Button, ConfigProvider, Result, Row, Typography } from "antd";
import { useEffect, useState } from "react";
import { ColorWKBlue, getAntdTheme } from "theme";
import backgroundOrganelles from "/images/background_mixed_cells_drawn.svg";

export function FailedToLoadView() {
  const [retries] = useState(() =>
    Number.parseInt(sessionStorage.getItem("wk_load_retries") || "0"),
  );

  useEffect(() => {
    if (retries < 3) {
      const timer = setTimeout(() => {
        sessionStorage.setItem("wk_load_retries", (retries + 1).toString());
        window.location.reload();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [retries]);

  const canAutoRetry = retries < 5;

  return (
    <ConfigProvider theme={getAntdTheme("dark")}>
      <Row
        justify="center"
        align="middle"
        style={{
          height: "100vh",
          marginTop: "calc(-1 * var(--navbar-height))",
          backgroundImage: `url(${backgroundOrganelles})`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
          backgroundColor: ColorWKBlue,
        }}
      >
        <Result
          status="error"
          title="Failed to load WEBKNOSSOS"
          subTitle={
            <Typography.Text>
              The server might still be starting up, please try again in a few seconds or check
              console output.
              {canAutoRetry && (
                <Typography.Paragraph>
                  Retrying automatically (Attempt {retries + 1}/5)...
                </Typography.Paragraph>
              )}
            </Typography.Text>
          }
          extra={[
            <Button key="reload" type="primary" onClick={() => window.location.reload()}>
              Reload Page
            </Button>,
          ]}
        />
      </Row>
    </ConfigProvider>
  );
}
