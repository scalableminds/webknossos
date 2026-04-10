import vxAlignmentSchema from "@images/vx/alignment-schema.png";
import vxManualAnnotationsVertical from "@images/vx/manual-annotations-vertical.png";
import vxSegmentationL4denseMottaEtAlDemoRotated from "@images/vx/segmentation-l4dense-motta-et-al-demo-rotated.jpg";
import { Button, Flex, Layout } from "antd";
import features from "features";
import { useWkSelector } from "libs/react_hooks";
import { useState } from "react";

const { Sider } = Layout;

const segmentationBanner = (
  <div
    className="crosslink-box"
    style={{
      background: `url(${vxSegmentationL4denseMottaEtAlDemoRotated})`,
      height: 500,
      backgroundSize: "110%",
      padding: 0,
      backgroundPosition: "center",
    }}
  >
    <div
      style={{
        padding: "180px 10px 213px",
        background:
          "linear-gradient(181deg, transparent, rgb(59 59 59 / 20%), rgba(20, 19, 31, 0.84), #48484833, transparent)",
      }}
    >
      <h4
        style={{
          color: "white",
          textAlign: "center",
        }}
      >
        Are you looking for an automated segmentation of this dataset?
      </h4>
      <Flex justify="center">
        <Button
          size="middle"
          href="https://webknossos.org/services/automated-segmentation"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            width: "50%",
          }}
        >
          Learn More
        </Button>
      </Flex>
    </div>
  </div>
);

const alignBanner = (
  <div className="crosslink-box">
    <h4
      style={{
        fontWeight: "bold",
        textAlign: "center",
      }}
    >
      Are you looking for dataset alignment or stitching?
    </h4>
    <img
      src={vxAlignmentSchema}
      alt="Schematic Alignment"
      style={{
        width: "100%",
      }}
    />
    <p>
      <a
        href="https://docs.webknossos.org/webknossos/automation/alignment.html"
        target="_blank"
        rel="noopener noreferrer"
      >
        Single-tile alignment
      </a>{" "}
      of image stacks can be done directly in WEBKNOSSOS.
    </p>
    <p>
      For multi-tile stacks, learn about our{" "}
      <a href="https://webknossos.org/services/alignment" target="_blank" rel="noopener noreferrer">
        alignment service
      </a>
      .
    </p>
  </div>
);

const manualAnnotationBanner = (
  <div
    className="crosslink-box"
    style={{
      background: `url(${vxManualAnnotationsVertical})`,
      height: 500,
      backgroundSize: "110%",
      padding: 0,
      backgroundPosition: "center",
    }}
  >
    <div
      style={{
        padding: "330px 10px 10px",
        background:
          "linear-gradient(181deg , transparent, rgba(59, 59, 59, 0.2), rgba(20, 19, 31, 0.84))",
      }}
    >
      <h4
        style={{
          color: "white",
          textAlign: "center",
        }}
      >
        Need more workforce for annotating your dataset?
        <br />
        Have a look at our annotation services.
      </h4>
      <Flex justify="center">
        <Button
          size="middle"
          href="https://webknossos.org/services/annotations"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            width: "50%",
          }}
        >
          Learn More
        </Button>
      </Flex>
    </div>
  </div>
);

const banners = [segmentationBanner, alignBanner, manualAnnotationBanner];

export default function VoxelyticsBanner() {
  const [bannerIndex] = useState(Math.floor(Math.random() * banners.length));
  const theme = useWkSelector((state) => state.uiInformation.theme);

  if (!features().isWkorgInstance) {
    return null;
  }

  return (
    <Sider
      className="hide-on-small-screen"
      width={300}
      theme={theme}
      style={{ backgroundColor: "var(--ant-layout-body-bg)" }}
    >
      {banners[bannerIndex]}
    </Sider>
  );
}
