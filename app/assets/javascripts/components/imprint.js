import React from "react";
import { Row, Col } from "antd";

const Imprint = () => (
  <div className="container text">
    <Row>
      <Col offset={6} span={12}>
        <h2>Imprint</h2>

        <h3>scalable minds UG (haftungsbeschränkt) & Co. KG</h3>
        <p>
          Großbeerenstraße 15<br />14482 Potsdam<br />Germany
        </p>
        <p>
          District Court Potsdam, HRA 5753<br />
          Managing Director: scalable minds Verwaltungs UG<br />
          (represented by Tom Bocklisch, Tom Herold, Norman Rzepka)<br />USt-Id. DE283513495
        </p>
        <p>
          <a href="mailto:hello@scalableminds.com">hello@scalableminds.com</a>
          <br />
          <a href="https://scalableminds.com">https://scalableminds.com</a>
        </p>

        <h3>Max Planck Institute for Brain Research</h3>
        <p>
          Dr. Moritz Helmstaedter<br />
          Director
        </p>

        <h5>Visiting address</h5>
        <p>
          Max-von-Laue-Str. 4<br />60438 Frankfurt am Main<br />Germany
        </p>

        <h5>Contact</h5>
        <p>
          <a href="tel:">+49 69 850033-3001</a>
          <br />
          <a href="mailto:mhoffice@brain.mpg.de">mhoffice@brain.mpg.de</a>
          <br />
          <a href="http://www.brain.mpg.de/connectomics">www.brain.mpg.de/connectomics</a>
        </p>
      </Col>
    </Row>
  </div>
);

export default Imprint;
