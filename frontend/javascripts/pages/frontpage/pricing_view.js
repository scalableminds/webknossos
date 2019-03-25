// @flow
import { withRouter, Link } from "react-router-dom";
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
  <Col lg={{ span: 8 }} md={{ span: 8 }} sm={{ span: 24 }} xs={{ span: 24 }}>
    <div
      style={{
        backgroundColor: "hsl(208, 21%, 88%)",
        padding: 60,
        textAlign: "center",
        height: "100%",
        ...contentStyle,
      }}
    >
      <h2>{title}</h2>
      <img src={iconUrl} style={{ height: 60 }} alt="icon" />
      {price === 0 ? (
        <h1 style={{ margin: 20, marginBottom: 60 }}>Free</h1>
      ) : (
        <>
          <h1 style={{ margin: 20, marginBottom: 5 }}>{price}€</h1>
          <p style={{ marginBottom: 40 }}>per month*</p>
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

const FAQItem = ({ title, children }: { title: string, children: Node }) => (
  <Col lg={{ span: 12 }} md={{ span: 12 }} sm={{ span: 24 }} xs={{ span: 24 }}>
    <div style={{ margin: 20 }}>
      <h4>{title}</h4>
      <p>{children}</p>
    </div>
  </Col>
);

const FeatureItem = ({
  title,
  subTitle,
  iconUrl,
}: {
  title: string,
  subTitle: string,
  iconUrl: string,
}) => (
  <Col lg={{ span: 8 }} md={{ span: 8 }} sm={{ span: 24 }} xs={{ span: 24 }}>
    <div style={{ padding: 40, textAlign: "center" }}>
      <div
        style={{
          padding: 35,
          borderRadius: "50%",
          backgroundColor: "hsl(208, 21%, 88%)",
          width: 140,
          height: 140,
          margin: "0 auto",
          textAlign: "center",
          verticalAlign: "middle",
          lineHeight: "70px",
        }}
      >
        <img src={iconUrl} alt="icon" style={{ width: 60, height: 60 }} />
      </div>
      <h4 style={{ marginTop: 20 }}>{title}</h4>
      <p style={{ marginTop: 20 }}>{subTitle}</p>
    </div>
  </Col>
);

const PricingView = () => (
  <>
    <div className="container" style={{ paddingTop: 20 }}>
      <Row gutter={16} type="flex" style={{ marginTop: 60, marginBottom: 60, textAlign: "center" }}>
        <Col
          lg={{ span: 16, offset: 4 }}
          md={{ span: 16, offset: 4 }}
          sm={{ span: 22, offset: 2 }}
          xs={{ span: 22, offset: 2 }}
        >
          <h1>Hosting Solutions</h1>
          <div>
            <h4>
              Our webKnossos hosting solutions get you started with webKnossos today. <br />
              Fast, functional, and flexible. Trusted by leading research labs.
            </h4>
          </div>
        </Col>
      </Row>
      <Row gutter={16} type="flex">
        <FeatureItem
          title="High Speed Skeleton Annotations"
          subTitle="Use our published Flight mode to quickly capture high-quality skeletons"
          iconUrl="/images/high-speed-tracing-icon.svg"
        />
        <FeatureItem
          title="Volume Annotation"
          subTitle="Create and proof-read dense volume annotations"
          iconUrl="/images/volume-annotation-icon.svg"
        />
        <FeatureItem
          title="Simple Collaboration"
          subTitle="webKnossos runs in the browser. Share links to annotations and publish datasets"
          iconUrl="/images/collaboration-icon.svg"
        />
      </Row>

      <Row gutter={16} type="flex" style={{ marginTop: 90, marginBottom: 100 }}>
        <PricingColumn title="Public Hosting" iconUrl="/images/public-hosting-icon.svg" price={0}>
          {[
            "Try out webKnossos for free with any published datasets on webknossos.org",
            "Unlimited accounts for your organization",
            "Suggest new datasets for publication",
            "Community Support",
            "All other wK features",
            <Link to="/onboarding" key="link-to-onboarding">
              <Button size="large" style={{ marginTop: 20 }}>
                Create a Free Account
              </Button>
            </Link>,
          ]}
        </PricingColumn>
        <PricingColumn
          title="Premium Hosting"
          iconUrl="/images/premium-hosting-icon.svg"
          price={250}
          contentStyle={{ marginTop: "-8%", height: "110%", backgroundColor: "hsl(208, 16%, 80%)" }}
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
        <Col span={4} push={20}>
          <div style={{ fontSize: "0.8em", textAlign: "right", marginTop: 5 }}>
            * VAT not included
          </div>
        </Col>
      </Row>
      <Row gutter={16}>
        <h1 style={{ textAlign: "center" }}>Frequently Asked Questions</h1>
        <FAQItem title="How do I get started?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="Why should I trust scalable minds with my data?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="Where is my data stored?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="Can I change my plan at a later time? Can I cancel anytime?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="Where can I learn more about webKnossos?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="What is the difference between Premium and Enterprise hosting?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
        <FAQItem title="What about open-source?">
          Bacon ipsum dolor amet tail ball tip fatback pork chicken. Venison boudin bresaola
          tri-tip, flank leberkas brisket ribeye spare ribs tongue. Kielbasa fatback brisket
          shankle, meatball sausage ham hock leberkas shank biltong ribeye jerky ham shoulder beef
          ribs. Swine landjaeger sausage kielbasa. Spare ribs jerky hamburger filet mignon pancetta,
          kevin bacon porchetta pig turkey pork loin ground round.
        </FAQItem>
      </Row>
    </div>
    <ImageAnalysisBlock />
    <CreditsFooter />
  </>
);

export default withRouter(PricingView);
