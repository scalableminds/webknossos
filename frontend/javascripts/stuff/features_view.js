// @flow
import { Row, Col } from "antd";
import React from "react";

const FeatureHighlight = ({ title, imageUrl, docsUrl = null, mirrored = false, children }) => {
  return (
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
};

const FeatureList = ({ title, children }) => {
  return (
    <Col md={{ span: 8 }} sm={{ span: 24 }}>
      <h3 style={{ textAlign: "center" }}>{title}</h3>
      {children.map(child => (
        <div key={child} style={{ margin: 30 }}>
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
};

export default function FeaturesView() {
  return (
    <>
      <div className="container" style={{ paddingTop: 20 }}>
        <h1 style={{ textAlign: "center", marginTop: 80, marginBottom: 50 }}>
          webKnossos Feature Overview
        </h1>
        <Row>
          <Col md={{ span: 16, offset: 4 }} sm={{ span: 24 }} xs={{ span: 24 }}>
            <p>
              webKnossos supports your research with efficient data management and advanced tools to
              create skeleton and volume annotations. It is optimized to manage terabytes of 3D
              microscopy image data, as required by Neuroscientists.
            </p>
            <p>
              webKnossos is developed as an open-source project in collaboration with international
              research partners.
            </p>
          </Col>
        </Row>
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
          mirrored={true}
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
          mirrored={true}
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
                <a href="https://docs.webknossos.org/guides/tracing_ui#skeleton-annotations">
                  Skeleton
                </a>{" "}
                &{" "}
                <a href="https://docs.webknossos.org/guides/tracing_ui#volume-annotations">
                  volume annotations
                </a>
              </>,
              <a href="https://docs.webknossos.org/guides/tracing_ui#flight-mode">
                High-speed Flight mode"
              </a>,
              "Segmentation proofreading",
              <a href="https://docs.webknossos.org/guides/tracing_ui#nodes-and-trees">
                Comments, trees & groups
              </a>,
              "Measurement tools",
              <a href="https://docs.webknossos.org/guides/mesh_visualization#stl-import">
                3D mesh support
              </a>,
              "Mapping support for volumes",
              <a href="https://docs.webknossos.org/guides/mesh_visualization#live-isosurface-generation">
                3D isosurface visualization
              </a>,
            ]}
          </FeatureList>
          <FeatureList title="Datasets">
            {[
              <a href="https://docs.webknossos.org/guides/datasets">
                Large-scale dataset management
              </a>,
              <a href="https://docs.webknossos.org/reference/data_formats">
                Multi-layer support (e.g. raw, segmentation)
              </a>,
              <a href="https://docs.webknossos.org/guides/datasets#using-external-datastores">
                On-premise data stores
              </a>,
              "Works with electron, light and fluorescence microscopes",
              <>
                <a href="https://docs.webknossos.org/reference/data_formats">
                  Wide range of data sources (WKW, Knossos cubes, Tiff,
                </a>
                <a href="https://github.com/scalableminds/webknossos-connect/">
                  Neuroglancer, BOSS)
                </a>
              </>,
              <a href="https://github.com/scalableminds/webknossos-wrap">
                Python and MATLAB libraries
              </a>,
            ]}
          </FeatureList>
          <FeatureList title="Collaboration">
            {[
              "Simple and intuitive web UI",
              <a href="https://docs.webknossos.org/guides/sharing#public-sharing">
                Built-in dataset and annotation publishing
              </a>,
              <a href="https://docs.webknossos.org/guides/sharing">
                Link sharing for datasets and annotations
              </a>,
              <a href="https://docs.webknossos.org/guides/tasks">User and task management</a>,
              <a hre="https://github.com/scalableminds/webknossos">Open-source project</a>,
              <a href="https://webknossos.org">Public featured datasets gallery</a>,
              <a href="https://docs.webKnossos.org">Documentation</a>,
            ]}
          </FeatureList>
        </Row>
      </div>

      <Row
        gutter={16}
        style={{
          marginLeft: "auto",
          marginRight: "auto",
          background:
            "linear-gradient(rgba(120, 120, 120, 0.45), rgba(120, 120, 120, 0.45)), url('/images/background_main_1080.jpg')",
        }}
      >
        <Col
          md={{ span: 12, offset: 4 }}
          style={{ backgroundColor: "white", margin: 80, padding: 40 }}
        >
          <h2>Looking for Automated AI Image Analysis?</h2>
          <p>
            webKnossos is excellent for viewing, managing and annotating large-scale image datasets
            but sometimes you need more power to scale.
          </p>
          <p>
            scalable minds offers a wide range of image analysis services for reconstructing rich
            information from microscope images. We can help with image alignment, dense
            segmentation, and object detection.
          </p>
          <a href="https://scalableminds.com/image-analysis">Learn more</a>
        </Col>
      </Row>
    </>
  );
}
