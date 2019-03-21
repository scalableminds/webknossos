// @flow
import { withRouter, type RouterHistory } from "react-router-dom";
import { Row, Col, Button } from "antd";
import React, { type Node } from "react";

const FeatureHighlight = ({
  title,
  imageUrl,
  docsUrl,
  mirrored = false,
  children,
}: {
  title: string,
  imageUrl: string,
  docsUrl: ?string,
  mirrored: boolean,
  children: Node,
}) => (
  <Row
    gutter={16}
    style={{ marginTop: 60 }}
    type="flex"
    justify="center"
    className={mirrored ? "feature-highlight-row" : null}
  >
    <Col
      key={title}
      lg={{ span: 8, offset: mirrored ? 2 : 0 }}
      md={{ span: 12, offset: 0 }}
      sm={{ span: 24, offset: 0 }}
      xs={{ span: 24, offset: 0 }}
    >
      <img src={imageUrl} alt="Some Text" style={{ objectFit: "contain" }} />
    </Col>
    <Col
      key={title}
      lg={{ span: 8, offset: mirrored ? 0 : 2 }}
      md={{ span: 12 }}
      sm={{ span: 24 }}
      xs={{ span: 24 }}
    >
      <h2>{title}</h2>
      <p>{children}</p>
      {docsUrl ? (
        <p>
          <a href={docsUrl}>Read More</a>
        </p>
      ) : null}
    </Col>
  </Row>
);

const FeatureList = ({ title, children }: { title: string, children: Array<Node> }) => (
  <Col md={{ span: 8 }} sm={{ span: 24 }}>
    <h3 style={{ textAlign: "center" }}>{title}</h3>
    {children.map((child: Node, i: number) => (
      <div key={i} style={{ margin: 30 }}>
        <img
          src="/images/feature-checkmark.svg"
          alt="checkmark"
          style={{ width: 30, height: 30, marginRight: 20, float: "left", maxWidth: "100%" }}
        />
        <div>{child}</div>
      </div>
    ))}
  </Col>
);

const FeaturesView = ({ history }: { history: RouterHistory }) => (
  <>
    <Row
      gutter={16}
      type="flex"
      align="center"
      style={{
        marginLeft: "auto",
        marginRight: "auto",
        color: "white",
        background:
          "linear-gradient(to bottom, #449efd7a 0%, #041a4abf 85%, #00050fc2 100%), url('/images/cover.jpg')",
      }}
    >
      <Col md={{ span: 14 }} style={{ margin: 80, padding: 40, fontSize: 18 }}>
        <h1 style={{ color: "white" }}>webKnossos</h1>
        <h4 style={{ color: "white" }}>
          The leading in-browser annotation tool for 3D microscopy data for researchers
        </h4>
        <p style={{ marginTop: 40 }}>
          webKnossos supports your research with efficient data management and advanced tools to
          create skeleton and volume annotations. It is optimized to manage terabytes of 3D
          microscopy image data, as required by Neuroscientists.
        </p>
        <p>
          webKnossos is developed as an open-source project in collaboration with international
          research partners.
        </p>
        <Button
          type="primary"
          size="large"
          style={{ marginTop: 40, marginRight: 20 }}
          onClick={() => history.push("/onboarding")}
        >
          Create Your Account
        </Button>
        <Button size="large">Get In Contact</Button>
      </Col>
    </Row>

    <div className="container" style={{ paddingTop: 20 }}>
      <FeatureHighlight
        title="High Speed Skeleton Tracing"
        imageUrl="/images/brain.png"
        docsUrl="https://docs.webknossos.org"
      >
        Bacon ipsum dolor amet sausage rump beef, turducken cupim short ribs capicola cow. Chuck
        tri-tip venison kevin, alcatra ham hock bacon filet mignon brisket. Buffalo drumstick
        burgdoggen ground round ham picanha jerky pig short loin capicola jowl tail. Biltong
        landjaeger tri-tip jowl pork chop, ham ground round strip steak ribeye boudin cow. Beef
        shoulder picanha strip steak, kevin leberkas meatloaf t-bone sirloin swine.
      </FeatureHighlight>

      <FeatureHighlight
        title="Simple Collaboration"
        imageUrl="/images/brain.png"
        docsUrl="https://docs.webknossos.org"
        mirrored
      >
        Bacon ipsum dolor amet sausage rump beef, turducken cupim short ribs capicola cow. Chuck
        tri-tip venison kevin, alcatra ham hock bacon filet mignon brisket. Buffalo drumstick
        burgdoggen ground round ham picanha jerky pig short loin capicola jowl tail. Biltong
        landjaeger tri-tip jowl pork chop, ham ground round strip steak ribeye boudin cow. Beef
        shoulder picanha strip steak, kevin leberkas meatloaf t-bone sirloin swine.
      </FeatureHighlight>

      <FeatureHighlight
        title="Efficient Volume Annotation"
        imageUrl="/images/brain.png"
        docsUrl="https://docs.webknossos.org"
      >
        Bacon ipsum dolor amet sausage rump beef, turducken cupim short ribs capicola cow. Chuck
        tri-tip venison kevin, alcatra ham hock bacon filet mignon brisket. Buffalo drumstick
        burgdoggen ground round ham picanha jerky pig short loin capicola jowl tail. Biltong
        landjaeger tri-tip jowl pork chop, ham ground round strip steak ribeye boudin cow. Beef
        shoulder picanha strip steak, kevin leberkas meatloaf t-bone sirloin swine.
      </FeatureHighlight>

      <FeatureHighlight
        title="Dataset Management"
        imageUrl="/images/brain.png"
        docsUrl="https://docs.webknossos.org"
        mirrored
      >
        Bacon ipsum dolor amet sausage rump beef, turducken cupim short ribs capicola cow. Chuck
        tri-tip venison kevin, alcatra ham hock bacon filet mignon brisket. Buffalo drumstick
        burgdoggen ground round ham picanha jerky pig short loin capicola jowl tail. Biltong
        landjaeger tri-tip jowl pork chop, ham ground round strip steak ribeye boudin cow. Beef
        shoulder picanha strip steak, kevin leberkas meatloaf t-bone sirloin swine.
      </FeatureHighlight>

      <FeatureHighlight title="Project & Task Management" imageUrl="/images/brain.png">
        Bacon ipsum dolor amet sausage rump beef, turducken cupim short ribs capicola cow. Chuck
        tri-tip venison kevin, alcatra ham hock bacon filet mignon brisket. Buffalo drumstick
        burgdoggen ground round ham picanha jerky pig short loin capicola jowl tail. Biltong
        landjaeger tri-tip jowl pork chop, ham ground round strip steak ribeye boudin cow. Beef
        shoulder picanha strip steak, kevin leberkas meatloaf t-bone sirloin swine.
      </FeatureHighlight>
      <h2 style={{ textAlign: "center", marginTop: 80, marginBottom: 50 }}>Feature Summary</h2>
      <Row gutter={16}>
        <FeatureList title="Annotations">
          {[
            <>
              <a key="1" href="https://docs.webknossos.org/guides/tracing_ui#skeleton-annotations">
                Skeleton
              </a>{" "}
              &{" "}
              <a key="2" href="https://docs.webknossos.org/guides/tracing_ui#volume-annotations">
                volume annotations
              </a>
            </>,
            <a key="3" href="https://docs.webknossos.org/guides/tracing_ui#flight-mode">
              High-speed Flight mode
            </a>,
            "Segmentation proofreading",
            <a key="4" href="https://docs.webknossos.org/guides/tracing_ui#nodes-and-trees">
              Comments, trees & groups
            </a>,
            "Measurement tools",
            <a key="5" href="https://docs.webknossos.org/guides/mesh_visualization#stl-import">
              3D mesh support
            </a>,
            "Mapping support for volumes",
            <a
              key="6"
              href="https://docs.webknossos.org/guides/mesh_visualization#live-isosurface-generation"
            >
              3D isosurface visualization
            </a>,
          ]}
        </FeatureList>
        <FeatureList title="Datasets">
          {[
            <a key="1" href="https://docs.webknossos.org/guides/datasets">
              Large-scale dataset management
            </a>,
            <a key="2" href="https://docs.webknossos.org/reference/data_formats">
              Multi-layer support (e.g. raw, segmentation)
            </a>,
            <a key="3" href="https://docs.webknossos.org/guides/datasets#using-external-datastores">
              On-premise data stores
            </a>,
            "Works with electron, light and fluorescence microscopes",
            <>
              <a href="https://docs.webknossos.org/reference/data_formats">
                Wide range of data sources (WKW, Knossos cubes, Tiff,
              </a>
              <a href="https://github.com/scalableminds/webknossos-connect/">Neuroglancer, BOSS)</a>
            </>,
            <a key="4" href="https://github.com/scalableminds/webknossos-wrap">
              Python and MATLAB libraries
            </a>,
          ]}
        </FeatureList>
        <FeatureList title="Collaboration">
          {[
            "Simple and intuitive web UI",
            <a key="1" href="https://docs.webknossos.org/guides/sharing#public-sharing">
              Built-in dataset and annotation publishing
            </a>,
            <a key="2" href="https://docs.webknossos.org/guides/sharing">
              Link sharing for datasets and annotations
            </a>,
            <a key="3" href="https://docs.webknossos.org/guides/tasks">
              User and task management
            </a>,
            <a key="4" href="https://github.com/scalableminds/webknossos">
              Open-source project
            </a>,
            <a key="5" href="https://webknossos.org">
              Public featured datasets gallery
            </a>,
            <a key="6" href="https://docs.webKnossos.org">
              Documentation
            </a>,
          ]}
        </FeatureList>
      </Row>
    </div>

    <Row
      gutter={16}
      style={{
        marginLeft: "auto",
        marginRight: "auto",
        marginTop: 80,
        background:
          "linear-gradient(rgba(120, 120, 120, 0.45), rgba(120, 120, 120, 0.45)), url('/images/background_main_1080.jpg')",
      }}
    >
      <Col
        md={{ span: 12, offset: 4 }}
        style={{ backgroundColor: "white", margin: 80, padding: 40 }}
      >
        <h2>Looking for Automated Image Analysis?</h2>
        <p>
          webKnossos is excellent for viewing, managing and annotating large-scale image datasets
          but sometimes you need more power to scale.
        </p>
        <p>
          scalable minds offers a wide range of machine learning based image analysis services for
          reconstructing rich information from microscope images. We can help with image alignment,
          dense segmentation, and object detection.
        </p>
        <a href="https://scalableminds.com/image-analysis">Learn more</a>
      </Col>
    </Row>
  </>
);

export default withRouter(FeaturesView);
