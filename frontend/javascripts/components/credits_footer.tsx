import { ConfigProvider, Layout } from "antd";
import { Typography } from "antd";
import { Link } from "react-router-dom";
import { getAntdTheme } from "theme";
const { Footer } = Layout;

const creditsFooter = () => (
  <ConfigProvider theme={getAntdTheme("dark")}>
    <Footer id="credits">
      <div style={{ maxWidth: 600 }}>
        <Typography.Title level={3}>WEBKNOSSOS Credits</Typography.Title>
        <Typography.Paragraph>
          Developed by <a href="https://scalableminds.com">scalable minds</a> and{" "}
          <a href="https://www.brain.mpg.de/connectomics">
            Max Planck Institute for Brain Research.
          </a>
        </Typography.Paragraph>
        <Typography.Paragraph>
          <a href="https://www.brain.mpg.de/connectomics">
            <img
              className="img-responsive"
              alt="Max Planck Gesellschaft logo"
              src="/images/Max-Planck-Gesellschaft.svg"
            />
          </a>
          <a href="https://www.brain.mpg.de/connectomics">
            <img
              className="img-responsive"
              alt="Max Planck Institute for Brain Research logo"
              src="/images/MPI-brain-research.svg"
            />
          </a>
          <a href="https://scalableminds.com">
            <img
              className="img-responsive"
              alt="scalable minds logo"
              src="/images/scalableminds_logo.svg"
            />
          </a>
        </Typography.Paragraph>
        <Typography.Paragraph>
          WEBKNOSSOS has been published in: Boergens Berning Bocklisch Bräunlein Drawitsch
          Frohnhofen Herold Otto Rzepka Werkmeister Werner Wiese Wissler & Helmstaedter, webKnossos:
          efficient online 3D data annotation for connectomics.{" "}
          <a href="https://dx.doi.org/10.1038/nmeth.4331">Nat. Meth. (2017) 14, 691–694</a>.
        </Typography.Paragraph>
        <Typography.Paragraph>
          The WEBKNOSSOS frontend was inspired by <a href="https://knossos.app">Knossos</a>.
        </Typography.Paragraph>
        <Typography.Paragraph>
          More information about the WEBKNOSSOS publication and full credits at{" "}
          <a href="https://publication.webknossos.org">publication.webknossos.org</a>.
        </Typography.Paragraph>
        <Typography.Paragraph>
          <Link to="/imprint">Imprint</Link> &bull; <Link to="/privacy">Privacy</Link> &bull;{" "}
          <a href="https://twitter.com/webknossos" target="_blank" rel="noopener noreferrer">
            Twitter
          </a>{" "}
          &bull;{" "}
          <a
            href="https://bsky.app/profile/webknossos.org"
            target="_blank"
            rel="noopener noreferrer"
          >
            Bluesky
          </a>
        </Typography.Paragraph>
      </div>
    </Footer>
  </ConfigProvider>
);

export default creditsFooter;
