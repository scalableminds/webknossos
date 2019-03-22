// @flow
import { withRouter, type RouterHistory } from "react-router-dom";
import { Row, Col, Button } from "antd";
import React from "react";
import CreditsFooter from "components/credits_footer";
import { ImageAnalysisBlock } from "pages/frontpage/features_view";

const PricingView = ({ history }: { history: RouterHistory }) => {
  const pricingColumStyle = {
    backgroundColor: "#eee",
    padding: 20,
  };

  return (
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
        <Col md={{ span: 14 }} xs={{ span: 24 }} style={{ margin: 80, padding: 40, fontSize: 18 }}>
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
            style={{ marginTop: 40, marginRight: 20, marginBottom: 20 }}
            onClick={() => history.push("/onboarding")}
          >
            Create A Free Account
          </Button>
          <a href="mailto:hello@scalableminds.com" style={{ color: "white" }}>
            Get In Contact With Us
          </a>
        </Col>
      </Row>
      <div className="container" style={{ paddingTop: 20 }}>
        <Row gutter={16}>
          <Col span={8} style={pricingColumStyle}>
            Foo
          </Col>
          <Col span={8} style={pricingColumStyle}>
            Bar
          </Col>
          <Col span={8} style={pricingColumStyle}>
            FooBar
          </Col>
        </Row>
      </div>
      <ImageAnalysisBlock />
      <CreditsFooter />
    </>
  );
};

export default withRouter(PricingView);
