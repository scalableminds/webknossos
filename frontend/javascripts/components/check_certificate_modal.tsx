import { isCertificateValid } from "admin/api/certificate_validation";
import { Col, Modal, Result, Row } from "antd";
import { useInterval } from "libs/react_helpers";
import _ from "lodash";
import { useEffect, useState } from "react";

export function CheckCertificateModal() {
  const [isValid, setIsValid] = useState(true);
  const [expiresAt, setExpiresAt] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    isCertificateValid().then(({ isValid, expiresAt }) => {
      setIsValid(isValid);
      setExpiresAt(expiresAt);
    });
  }, []);
  useInterval(
    async () => {
      const { isValid, expiresAt } = await isCertificateValid();
      setIsValid(isValid);
      setExpiresAt(expiresAt);
    },
    5 * 60 * 1000,
  );
  if (isValid) {
    return null;
  }
  const expiresAtDate = new Date(expiresAt * 1000).toLocaleString();
  return (
    <Modal
      open={true}
      closable={false}
      footer={null}
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
                Sorry, your WEBKNOSSOS license has expired at {expiresAtDate}.
                <br />
                Please{" "}
                <a
                  target="_blank"
                  rel="noreferrer"
                  href="mailto:hello@webknossos.org"
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  contact us
                </a>{" "}
                to renew your license.
              </span>
            }
            style={{ height: "100%" }}
          />
        </Col>
      </Row>
    </Modal>
  );
}
