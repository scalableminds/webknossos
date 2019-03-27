// @flow
import { withRouter, type RouterHistory } from "react-router-dom";
import { Row, Col, Button, Icon } from "antd";
import React, { type Node, Fragment } from "react";
import CreditsFooter from "components/credits_footer";
import { bgColorLight } from "pages/frontpage/pricing_view";

const FeatureHighlight = ({
  title,
  imageUrl,
  docsUrl,
  mirrored = false,
  children,
}: {
  title: string,
  imageUrl: string,
  docsUrl?: ?string,
  mirrored?: boolean,
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
      key={`${title}-image`}
      lg={{ span: 8, offset: mirrored ? 2 : 0 }}
      md={{ span: 12, offset: 0 }}
      sm={{ span: 24, offset: 0 }}
      xs={{ span: 24, offset: 0 }}
    >
      <img src={imageUrl} alt={title} style={{ objectFit: "contain", maxWidth: "100%" }} />
    </Col>
    <Col
      key={`${title}-text`}
      lg={{ span: 8, offset: mirrored ? 0 : 2 }}
      md={{ span: 12 }}
      sm={{ span: 24 }}
      xs={{ span: 24 }}
    >
      <h3>{title}</h3>
      {children}
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
      <div key={String(i)} style={{ margin: 30 }}>
        <img
          src="/assets/images/feature-checkmark.svg"
          alt="checkmark"
          style={{ width: 30, height: 30, marginRight: 20, float: "left", maxWidth: "100%" }}
        />
        <div>{child}</div>
      </div>
    ))}
  </Col>
);

export const ImageAnalysisBlock = () => (
  <Row
    gutter={16}
    style={{
      marginLeft: "auto",
      marginRight: "auto",
      background:
        "linear-gradient(rgba(120, 120, 120, 0.45), rgba(120, 120, 120, 0.45)), url('/assets/images/background_main_1080.jpg')",
    }}
  >
    <Col md={{ span: 12, offset: 4 }} style={{ backgroundColor: "white", margin: 80, padding: 40 }}>
      <h2>Looking for Automated Image Analysis?</h2>
      <p>
        webKnossos is excellent for viewing, managing and annotating large-scale image datasets but
        sometimes you need more power to scale.
      </p>
      <p>
        scalable minds offers a wide range of machine learning based image analysis services for
        reconstructing rich information from microscope images. We can help with image alignment /
        registration, dense segmentation, and object detection.
      </p>
      <a href="https://scalableminds.com/image-analysis">Learn more</a>
    </Col>
  </Row>
);

export const SocialMediaBlock = () => (
  <Row
    gutter={16}
    type="flex"
    align="center"
    style={{
      marginLeft: "auto",
      marginRight: "auto",
      backgroundColor: bgColorLight,
      marginTop: 40,
    }}
  >
    <Col md={{ span: 12 }} sm={{ span: 24 }}>
      <div
        style={{
          padding: 60,
          textAlign: "center",
        }}
      >
        <h2 style={{ marginTop: 20 }}>Follow us</h2>
        <h4 style={{ marginTop: 30, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
          Join us on social media and stay up-to-date on the latest webKnossos features.
        </h4>
        <div style={{ marginTop: 30 }}>
          <a href="https://twitter.com/webknossos" target="_blank" rel="noopener noreferrer">
            <Icon type="twitter" style={{ marginRight: 20, marginLeft: 20, fontSize: 40 }} />
          </a>
          <a href="https://medium.com/scalableminds" target="_blank" rel="noopener noreferrer">
            <Icon type="medium" style={{ marginRight: 20, marginLeft: 20, fontSize: 40 }} />
          </a>
          <a
            href="https://github.com/scalableminds/webknossos"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon type="github" style={{ marginRight: 20, marginLeft: 20, fontSize: 40 }} />
          </a>
        </div>
      </div>
    </Col>
  </Row>
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
        background: "linear-gradient(hsl(208, 100%, 46%), hsl(208, 30%, 38%))",
        color: "white",
      }}
    >
      <Col md={{ span: 14 }} xs={{ span: 24 }} style={{ margin: 80, padding: 40, fontSize: 18 }}>
        <h2 style={{ color: "white" }}>
          The leading in-browser annotation tool for 3D microscopy data for researchers
        </h2>
        <p style={{ marginTop: 40 }}>
          webKnossos supports your research with efficient data management and advanced tools to
          create skeleton and volume annotations. It is optimized to manage petabytes of 3D
          microscopy image data, as required by Neuroscientists.
        </p>
        <p>
          webKnossos is developed as an open-source project in collaboration with international
          research partners.
        </p>
        <Button
          type="primary"
          size="large"
          style={{ marginTop: 40, marginRight: 50, marginBottom: 20 }}
          onClick={() => history.push("/onboarding")}
        >
          Create a Free Account
        </Button>
        <a
          href="mailto:hello@scalableminds.com"
          style={{ fontSize: 16, color: "hsla(209, 100%, 95%, 1)" }}
        >
          Ask a Question
        </a>
      </Col>
    </Row>

    <div className="container">
      <FeatureHighlight
        title="High Speed Skeleton Tracing"
        imageUrl="/assets/images/feature-skeleton.png"
        docsUrl="https://docs.webknossos.org/guides/tracing_ui#skeleton-annotations"
      >
        <p>
          Use <em>Flight mode</em> to quickly capture high-quality skeleton annotations. Organize
          the UI to fit your needs and discover your data in the easy-to-use viewer.
        </p>
        <p>
          Create fine-grained skeleton annotations: Mark branch points and overlay 3D mesh
          structures on your data. Easily organize your skeletons into groups and highlight special
          interest regions with comments.
        </p>
      </FeatureHighlight>

      <FeatureHighlight
        title="Simple Collaboration"
        imageUrl="/assets/images/feature-sharing.png"
        docsUrl="https://docs.webknossos.org/guides/sharing"
        mirrored
      >
        <p>
          As a web-based application, webKnossos makes it extremely easy to share links to your
          datasets and annotations. Send protected deep links to regions within your dataset for
          your colleagues to review.
        </p>
        <p>
          Support your paper publications by publishing your datasets and annotations with
          webKnossos for everyone to discover. No registration required and immediate access to
          viewing the original data.
        </p>
      </FeatureHighlight>

      <FeatureHighlight
        title="Efficient Volume Annotation"
        imageUrl="/assets/images/feature-volume.png"
        docsUrl="https://docs.webknossos.org/guides/tracing_ui#volume-annotations"
      >
        <p>
          Use webKnossos to create and proof-read dense 3D volume annotations. Advanced tools make
          it easy to label volume data in order to train a machine learning model. Quickly refine
          existing annotations and correct mistakes created from automated segmentation systems.
        </p>
        <p>Explore your volume data in 3D through on-the-fly 3D isosurface visualizations.</p>
      </FeatureHighlight>

      <FeatureHighlight
        title="Dataset Management"
        imageUrl="/assets/images/feature-datasets.png"
        docsUrl="https://docs.webknossos.org/reference/data_formats"
        mirrored
      >
        <p>
          webKnossos supports a wide range of common 3D data formats. (Knossos cubes, WKW,
          Neuroglancer Precomputed, BossDB, Tiff Stacks) Datasets can be hosted on-premise or in our
          cloud for simplicity.
        </p>
        <p>
          Work with multi-channel datasets. From simple grayscale and RGB data to (multi-channel)
          segmentation layers. webKnossos is optimized for working with 3D electron, light, and
          fluorescence microscopy datasets.
        </p>
        <p>
          Datasets support access-level control and can be securely shared with colleagues and made
          available for reviewers.
        </p>
      </FeatureHighlight>

      <FeatureHighlight
        title="Project & Task Management"
        imageUrl="/assets/images/feature-projects.png"
        docsUrl="https://docs.webknossos.org/guides/tasks"
      >
        <p>
          Reconstructing large-scale Connectomics datasets can be daunting. Manage skeleton and
          volume annotations with advanced project and task management features. Leverage
          auto-assignments within your team or crowd-sourcing. View and download the aggregated
          individual results as a whole project.
        </p>
        <p>
          Fine-grained user access levels and subteams help you manage datasets and tasks within
          your lab.
        </p>
      </FeatureHighlight>
    </div>

    <SocialMediaBlock />

    <div className="container">
      <h2 style={{ textAlign: "center", marginTop: 80, marginBottom: 50 }}>Feature Summary</h2>
      <Row gutter={16}>
        <FeatureList title="Annotations">
          {[
            <Fragment key="1">
              <a href="https://docs.webknossos.org/guides/tracing_ui#skeleton-annotations">
                Skeleton
              </a>{" "}
              &{" "}
              <a href="https://docs.webknossos.org/guides/tracing_ui#volume-annotations">
                volume annotations
              </a>
            </Fragment>,
            <a key="2" href="https://docs.webknossos.org/guides/tracing_ui#flight-mode">
              High-speed Flight mode
            </a>,
            "Segmentation proofreading",
            <a key="3" href="https://docs.webknossos.org/guides/tracing_ui#nodes-and-trees">
              Comments, trees & groups
            </a>,
            "Measurement tools",
            <a key="4" href="https://docs.webknossos.org/guides/mesh_visualization#stl-import">
              3D mesh support
            </a>,
            "Mapping support for volumes",
            <a
              key="5"
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
            <Fragment key="4">
              <a href="https://docs.webknossos.org/reference/data_formats">
                Wide range of data sources (WKW, Knossos cubes, Tiff,
              </a>
              <a href="https://github.com/scalableminds/webknossos-connect/">
                {" "}
                Neuroglancer, BossDB)
              </a>
            </Fragment>,
            <a key="5" href="https://github.com/scalableminds/webknossos-wrap">
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

    <div style={{ marginTop: 80 }}>
      <ImageAnalysisBlock />
    </div>

    <CreditsFooter />
  </>
);

export default withRouter(FeaturesView);
