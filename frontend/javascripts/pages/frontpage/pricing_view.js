// @flow
import { withRouter, Link } from "react-router-dom";
import { Row, Col, Button } from "antd";
import React, { type Node } from "react";
import CreditsFooter from "components/credits_footer";
import { ImageAnalysisBlock, SocialMediaBlock } from "pages/frontpage/features_view";
import { trackAction } from "oxalis/model/helpers/analytics";

export const bgColorLight = "hsl(208, 21%, 88%)";
export const bgColorDark = "hsl(208, 100%, 46%)";

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
}) => {
  const fontColor = contentStyle ? contentStyle.color : "inherit";

  return (
    <Col lg={{ span: 8 }} md={{ span: 8 }} sm={{ span: 24 }} xs={{ span: 24 }}>
      <div
        style={{
          backgroundColor: bgColorLight,
          padding: 60,
          textAlign: "center",
          height: "100%",
          ...contentStyle,
        }}
      >
        <h2 style={{ color: fontColor }}>{title}</h2>
        <img
          src={iconUrl}
          style={{ height: 60, filter: fontColor === "white" ? "invert(1)" : null }}
          alt="icon"
        />
        {price === 0 ? (
          <h1 style={{ margin: 20, marginBottom: 60, color: fontColor || "inherit" }}>Free</h1>
        ) : (
          <>
            <h1 style={{ margin: 20, marginBottom: 5, color: fontColor || "inherit" }}>
              From {price}€
            </h1>
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
};

const FAQItem = ({ title, children }: { title: string, children: Node }) => (
  <Col lg={{ span: 12 }} md={{ span: 12 }} sm={{ span: 24 }} xs={{ span: 24 }}>
    <div style={{ margin: "30px 60px" }}>
      <h4>{title}</h4>
      {children}
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
          backgroundColor: bgColorDark,
          width: 140,
          height: 140,
          margin: "0 auto",
          textAlign: "center",
          verticalAlign: "middle",
          lineHeight: "70px",
        }}
      >
        <img src={iconUrl} alt="icon" style={{ width: 60, height: 60, filter: "invert(1)" }} />
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
            "All webKnossos features",
            <Link to="/onboarding" key="link-to-onboarding">
              <Button
                size="large"
                style={{ marginTop: 20 }}
                onClick={() => trackAction("[Pricing] CreateFreeAccount")}
              >
                Create a Free Account
              </Button>
            </Link>,
          ]}
        </PricingColumn>

        <PricingColumn
          title="Premium Hosting"
          iconUrl="/images/premium-hosting-icon.svg"
          price={250}
          contentStyle={{
            marginTop: "-8%",
            height: "110%",
            backgroundColor: bgColorDark,
            color: "white",
          }}
        >
          {[
            "Upload and work with your data hosted on scalable minds servers",
            "From 100GB of data storage**",
            "Managed monitoring and backups",
            "Help with dataset upload and conversion ",
            "Email support",
            "+ Everything from the Public Hosting",
            <a href="mailto:hello@scalableminds.com" key="email-button">
              <Button
                size="large"
                style={{ marginTop: 20 }}
                onClick={() => trackAction("[Pricing] PremiumHosting")}
              >
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
            "+ Everything from Premium Hosting",
            <a href="mailto:hello@scalableminds.com" key="email-button">
              <Button
                size="large"
                style={{ marginTop: 20 }}
                onClick={() => trackAction("[Pricing] CustomHosting")}
              >
                Get in Touch
              </Button>
            </a>,
          ]}
        </PricingColumn>
        <Col span={24}>
          <div style={{ fontSize: "0.8em", textAlign: "right", marginTop: 5 }}>
            * VAT not included ** higher storage tiers available
          </div>
        </Col>
      </Row>

      <h1 style={{ textAlign: "center" }}>Frequently Asked Questions</h1>
      <Row gutter={16} type="flex" align="start">
        <FAQItem title="How do I get started?">
          <p>
            You can try webKnossos for free with any of public dataset here on webknossos.org.{" "}
            <Link to="/onboarding" onClick={() => trackAction("[Pricing] CreateFreeAccount")}>
              Create a free account today.
            </Link>
          </p>
          <p>
            All webKnossos features can be used with free accounts. Try it with the{" "}
            <Link to="/spotlight">available published datasets.</Link> We are also happy to
            integrate your dataset in the publication gallery. Alternatively, upgrade to the Premium
            plan and start working with your unreleased, private data.
          </p>
          <p>
            You can learn more about webKnosssos in the{" "}
            <a href="https://docs.webknossos.org">user documentation</a>. Alternatively,{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              get in touch with us
            </a>{" "}
            and one of our webKnossos experts will help you get started.
          </p>
        </FAQItem>
        <FAQItem title="Why should I trust scalable minds with my data?">
          <p>
            Data security is one of our top priorities. All datasets uploaded on webknossos.org are
            stored securely in the scalable minds cloud infrastructure and NOT shared with anyone.
            webKnossos has fine-grained permissions for individual users, teams, and datasets to
            control the access. Only authorized users within your organization will be able to
            access your datasets and annotations. Read our{" "}
            <Link to="privacy">privacy statement</Link>.
          </p>
          <p>
            We offer a Custom hosting plan, where datasets can be directly stored in your data
            center.{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              Get in touch with us
            </a>{" "}
            to learn more.
          </p>
        </FAQItem>
        <FAQItem title="Where is my data stored?">
          <p>
            All datasets uploaded on webknossos.org are stored securely in the scalable minds cloud
            infrastructure in Germany.
          </p>
          <p>
            We offer a Custom hosting plan, where datasets can be directly stored in your data
            center.{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              Get in touch with us
            </a>{" "}
            to learn more.
          </p>
        </FAQItem>
        <FAQItem title="I need more than 100GB of storage for my dataset.">
          <p>
            Our Premium plan includes 100GB of storage for datasets and annotations to get you
            started. Each additional terabyte of storage costs an additional 50€ per month*.
          </p>
          <p>
            For details and pricing{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              get in touch with us
            </a>
            .
          </p>
        </FAQItem>
        <FAQItem title="Which payment methods are available?">
          <p>
            We accept payment through credit card, PayPal and bank transfer. Billing is on an annual
            basis.
          </p>
        </FAQItem>
        <FAQItem title="Can I change my plan at a later time? Can I cancel anytime?">
          <p>
            Plans are billed annually. You can cancel your plan at the end of your billing cycle.
            You can try webKnossos for free here on webKnossos.org.
          </p>
          <p>
            You can always upgrade your plan later. We are happy to assist you with migrating your
            data if necessary.
          </p>
        </FAQItem>
        <FAQItem title="I am looking for a custom webKnossos setup.">
          <p>
            We are happy to help you find a custom solution for setting up webKnossos. Over the
            years we have worked with different research institutes and have tackled a diverse set
            of challenges. Custom data formats, petabyte-scale datasets, on-premise or cloud
            storage, file system tuning, monitoring...
          </p>
          <p>
            Our Custom hosting plan is right for you.{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              Talk to our webKnossos experts about custom solutions.
            </a>
          </p>
        </FAQItem>
        <FAQItem title="Where can I learn more about webKnossos?">
          <p>
            webKnossos offers a wide array of tools to manage large 3D datasets and annotate them
            efficiently. Learn more about webKnossos and its functionality on our{" "}
            <Link to="features">features overview page.</Link>
          </p>
          <p>
            Check out the webKnosssos <a href="https://docs.webknossos.org">user documentation</a>{" "}
            to learn more about all annotation modes and their settings. Alternatively,{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              get in touch with us
            </a>{" "}
            and one of our webKnossos experts will help you get started.
          </p>
          <p>
            Make sure to follow{" "}
            <a href="https://twitter.com/webknossos" target="_blank" rel="noopener noreferrer">
              webKnossos on Twitter
            </a>{" "}
            to get updates about the latest features.
          </p>
        </FAQItem>
        <FAQItem title="What is the difference between Premium and Custom hosting?">
          <p>
            Our Premium plan makes it simple for you to get started. We provide you with a fully
            managed and preconfigured version of webKnossos that can grow with your needs. No
            installation required. All data is hosted on the scalable minds cloud infrastructure.
          </p>
          <p>
            Some clients prefer to store their datasets on-premise, within their infrastructure or
            have exceptional data needs. With our Custom plan, webKnossos can be configured to load
            data from a dedicated data store on your servers.
          </p>
        </FAQItem>
        <FAQItem title="I need a new functionality not yet available in webKnossos,">
          <p>
            We constantly develop new features and continuously improve webKnossos. As an
            open-source project, you can extend webKnossos yourself. webKnossos also comes with a
            rich <a href="https://webknossos.org/docs/frontend-api/index.html">frontend API</a> and{" "}
            <a href="https://docs.webknossos.org/reference/rest_api">REST interface</a> for
            scripting new workflows. Alternatively, you can hire us to help you with custom feature
            development.
          </p>
          <p>
            We are always interested in learning about new ideas and gathering feedback.{" "}
            <a href="mailto:hello@scalableminds.com" onClick={() => trackAction("EmailContact")}>
              get in touch with us and let us know.
            </a>
          </p>
        </FAQItem>
        <FAQItem title="What about open-source?">
          <p>
            webKnossos is an open-source project developed by{" "}
            <a href="https://scalableminds.com">scalable minds</a> in collaboration with the{" "}
            <a href="https://www.brain.mpg.de/connectomics">
              Max-Planck-Institute for Brain Research
            </a>
            . webKnossos is methodically proven and published in{" "}
            <a href="https://dx.doi.org/10.1038/nmeth.4331">Nature Methods (2017) 14, 691-694</a>.
          </p>
          <p>
            All hosting plans on this website are executed and handled exclusively by scalable
            minds.
          </p>
        </FAQItem>
        <FAQItem title="What is the difference between Knossos and webKnossos?">
          <p>
            While webKnossos and Knossos share some of the roots, they are two distinct software
            tools for viewing and annotating 3D datasets developed by different teams.
          </p>
          <p>
            webKnossos supports a wide array of popular data formats (Knossos cubes, WKW,
            Neuroglancer Precomputed, BossDB, Tiff Stacks) and is used for creating both skeleton
            and volume annotations. As browser-based application, it is easy to share links to
            datasets and publish datasets for other to review.
          </p>
        </FAQItem>

        <FAQItem title="Who develops and runs webKnossos?">
          <p>
            webKnossos is an open-source project developed by{" "}
            <a href="https://scalableminds.com">scalable minds</a> in collaboration with the{" "}
            <a href="https://www.brain.mpg.de/connectomics">
              Max-Planck-Institute for Brain Research.
            </a>
          </p>
          <p>
            All hosting plans on this website are executed and handled exclusively by scalable
            minds.
          </p>
        </FAQItem>
      </Row>
    </div>

    <SocialMediaBlock />

    <ImageAnalysisBlock />
    <CreditsFooter />
  </>
);

export default withRouter(PricingView);
