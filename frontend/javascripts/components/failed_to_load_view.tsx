import { Button, Card, ConfigProvider, Result, Row, Typography } from "antd";
import useInterval from "beautiful-react-hooks/useInterval";
import { ColorWKBlue, getAntdTheme } from "theme";
import backgroundMixedCellsDrawn from "@images/backgrounds/background-mixed-cells-drawn.svg";

export function FailedToLoadView() {
  useInterval(() => {
    if (import.meta.env.DEV) {
      window.location.reload();
    }
  }, 5000);

  return (
    <ConfigProvider theme={getAntdTheme("light")}>
      <Row
        justify="center"
        align="middle"
        style={{
          height: "100vh",
          marginTop: "calc(-1 * var(--navbar-height))",
          backgroundImage: `url(${backgroundMixedCellsDrawn})`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundAttachment: "fixed",
          backgroundColor: ColorWKBlue,
        }}
      >
        <Card>
          <Result
            status="error"
            title="Failed to load WEBKNOSSOS"
            subTitle={
              <Typography.Text>
                The server might still be starting up, please try again in a few seconds or check
                console output.
              </Typography.Text>
            }
            extra={[
              <Button key="reload" type="primary" onClick={() => window.location.reload()}>
                Reload Page
              </Button>,
            ]}
          />
        </Card>
      </Row>
    </ConfigProvider>
  );
}
