import proofreadingDendrites from "@images/vx/proofreading-dendrites.webp";
import { Badge, Button, Flex, Typography, theme } from "antd";
import { ColorWKBlueZircon } from "theme";
import { SecondaryText, smallCapsStyle } from "../components/typography";

/** Points to the proofreading tools once a segmentation job has started. Callers gate it to webknossos.org. */
export function ProofreadingNextStep() {
  const { cssVar } = theme.useToken();
  return (
    <Flex vertical align="flex-start" gap="middle">
      <div
        role="img"
        aria-label="Proofread dendrite segments"
        style={{
          alignSelf: "stretch",
          height: 120,
          borderRadius: cssVar.borderRadiusLG,
          backgroundImage: `linear-gradient(to bottom, transparent 40%, ${cssVar.colorBgContainer}), url(${proofreadingDendrites})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <Flex vertical gap="small">
        <Badge
          color={ColorWKBlueZircon}
          text={
            <Typography.Text type="secondary" style={smallCapsStyle}>
              Next step · Proofreading
            </Typography.Text>
          }
        />
        <Typography.Title level={5} style={{ margin: 0, fontWeight: 500 }}>
          Proofread your segmentation.
        </Typography.Title>
        <SecondaryText>
          Fix split and merge errors on large segmentations with supervoxel-graph editing.
          Collaborative and near real time.
        </SecondaryText>
      </Flex>
      <Button
        href="https://docs.webknossos.org/webknossos/proofreading/proofreading_tool.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        See proofreading tools
      </Button>
    </Flex>
  );
}
