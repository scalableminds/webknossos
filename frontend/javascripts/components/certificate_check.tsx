import { Col, Modal, Result, Row } from "antd";
import { useInterval } from "libs/react_helpers";
import _ from "lodash";
import { useState, useEffect } from "react";
import { isCertificateValid } from "admin/api/certificate_validation";

export function CheckCertificateModal() {
  const [isValid, setIsValid] = useState(true);
  useEffect(() => {
    isCertificateValid().then(({ valid }) => setIsValid(valid));
  }, []);
  useInterval(
    async () => {
      const { valid } = await isCertificateValid();
      setIsValid(valid);
    },
    5 * 60 * 1000,
  );
  if (isValid) {
    return null;
  }
  return (
    <Modal
      open={true}
      title="Certificate Expired"
      closable={false}
      onCancel={_.noop}
      width={"70%"}
      keyboard={false}
      maskClosable={false}
    >
      <Row
        justify="center"
        align="middle"
        className="background-organelles-modal ant-app"
        style={{ maxHeight: "50%", width: "auto" }}
      >
        <Col>
          <Result
            icon={<i className="drawing drawing-404" />}
            status="warning"
            title={
              <span style={{ color: "white" }}>
                Sorry, your WEBKNOSSOS subscription has ended.
                <br />
                Please{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="mailto:webknossos@scm.io"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  contact us
                </a>{" "}
                to review your certificate.
              </span>
            }
            style={{ height: "100%" }}
          />
        </Col>
      </Row>
    </Modal>
  );
}
