import { ConfigProvider, Layout } from "antd";
import { Link } from "react-router-dom";
import { getAntdTheme } from "theme";
const { Footer } = Layout;

const creditsFooter = () => (
  <ConfigProvider theme={getAntdTheme("dark")}>
    <Footer id="credits">
      <div style={{ maxWidth: 600 }}>
        <h3>WEBKNOSSOS Credits</h3>
        <p>
          Developed by <a href="https://scalableminds.com">scalable minds</a> and{" "}
          <a href="https://www.brain.mpg.de/connectomics">
            Max Planck Institute for Brain Research.
          </a>
        </p>
        <p>
          <a href="https://www.brain.mpg.de/connectomics">
            <img
              className="img-responsive"
              alt="Max Planck Gesellschaft logo"
              src="/assets/images/Max-Planck-Gesellschaft.svg"
            />
          </a>
          <a href="https://www.brain.mpg.de/connectomics">
            <img
              className="img-responsive"
              alt="Max Planck Institute for Brain Research logo"
              src="/assets/images/MPI-brain-research.svg"
            />
          </a>
          <a href="https://scalableminds.com">
            <img
              className="img-responsive"
              alt="scalable minds logo"
              src="/assets/images/scalableminds_logo.svg"
            />
          </a>
        </p>
        <p>
          WEBKNOSSOS has been published in: Boergens Berning Bocklisch Bräunlein Drawitsch
          Frohnhofen Herold Otto Rzepka Werkmeister Werner Wiese Wissler & Helmstaedter, webKnossos:
          efficient online 3D data annotation for connectomics.{" "}
          <a href="https://dx.doi.org/10.1038/nmeth.4331">Nat. Meth. (2017) 14, 691–694</a>.
        </p>
        <p>
          The WEBKNOSSOS frontend was inspired by <a href="https://knossos.app">Knossos</a>.
        </p>
        <p>
          More information about the WEBKNOSSOS publication and full credits at{" "}
          <a href="https://publication.webknossos.org">publication.webknossos.org</a>.
        </p>
        <p>
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
        </p>
      </div>
    </Footer>
  </ConfigProvider>
);

export default creditsFooter;
