// @flow
import { withRouter, type RouterHistory, Link } from "react-router-dom";
import { Row, Col, Button } from "antd";
import React, { type Node } from "react";
import CreditsFooter from "components/credits_footer";
import { ImageAnalysisBlock } from "pages/frontpage/features_view";

const PricingColumn = ({
  title,
  price,
  iconUrl,
  children,
  contentStyle,
}: {
  title: string,
  price: number,
  iconUrl: string,
  children: Array<Node>,
  contentStyle?: Object,
}) => (
  <Col span={8}>
    <div
      style={{
        backgroundColor: "#eee",
        padding: 60,
        textAlign: "center",
        height: "100%",
        ...contentStyle,
      }}
    >
      <h2>{title}</h2>
      <img src={iconUrl} style={{ height: 60 }} alt="icon" />
      {price === 0 ? (
        <h1 style={{ margin: 20, marginBottom: 40 }}>Free</h1>
      ) : (
        <>
          <h1 style={{ margin: 20, marginBottom: 5 }}>{price}€</h1>
          <p style={{ marginBottom: 20 }}>per month*</p>
        </>
      )}
      {children.map((child, i) => (
        <p style={{ marginBottom: 20 }} key={String(i)}>
          {child}
        </p>
      ))}
    </div>
  </Col>
);

const PricingView = ({ history }: { history: RouterHistory }) => (
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
      <Row gutter={16} type="flex">
        <PricingColumn title="Public Hosting" iconUrl="/images/public-hosting-icon.svg" price={0}>
          {[
            "Try out webKnossos for free with any published datasets on webknossos.org",
            "Unlimited accounts for your organization",
            "Suggest new datasets for publication",
            "Community Support",
            "All other wK features",
            <Link to="/onboarding" key="link-to-onboarding">
              <Button size="large" style={{ marginTop: 20 }}>
                Create A Free Account
              </Button>
            </Link>,
          ]}
        </PricingColumn>
        <PricingColumn
          title="Premium Hosting"
          iconUrl="/images/premium-hosting-icon.svg"
          price={250}
          contentStyle={{ marginTop: "-8%", height: "110%", backgroundColor: "#ddd" }}
        >
          {[
            "Upload and work with your data hosted on scalable minds servers",
            "From 100GB of data storage",
            "Managed monitoring and backups",
            "Help with dataset upload and conversion ",
            "Email support",
            "Everything from the Public Hosting",
            <a href="mailto:hello@scalableminds.com" key="email-button">
              <Button size="large" style={{ marginTop: 20 }} type="primary">
                Get in Touch
              </Button>
            </a>,
          ]}
        </PricingColumn>
        <PricingColumn title="Custom Hosting" iconUrl="/images/custom-hosting-icon.svg" price={800}>
          {[
            "On-Premise hosting of your data",
            "Unlimited data storage",
            "Priority Email & Slack Support",
            "Insights about the development roadmap",
            "Custom hosting solutions",
            "Everything from Premium Hosting",
            <a href="mailto:hello@scalableminds.com" key="email-button">
              <Button size="large" style={{ marginTop: 20 }}>
                Get in Touch
              </Button>
            </a>,
          ]}
        </PricingColumn>
      </Row>
    </div>
    <ImageAnalysisBlock />
    <CreditsFooter />
  </>
);

export default withRouter(PricingView);
