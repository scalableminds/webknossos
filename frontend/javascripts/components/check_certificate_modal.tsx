import { isCertificateValid } from "admin/api/certificate_validation";
import { Col, Modal, Result, Row } from "antd";
import { useInterval } from "libs/react_helpers";
import _ from "lodash";
import { useEffect, useState } from "react";
import FormattedDate from "./formatted_date";

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
    5 * 60 * 1000, // 5 minutes
  );
  if (isValid) {
    return null;
  }
  return (
    <Modal
      open={true}
      closable={false}
      footer={null}
      onCancel={_.noop}
      width={"max(70%, 600px)"}
      keyboard={false}
      maskClosable={false}
    >
      <Row justify="center" align="middle" style={{ maxHeight: "50%", width: "auto" }}>
        <Col>
          <Result
            icon={<i className="drawing drawing-license-expired" />}
            status="warning"
            title={
              <span>
                Sorry, your WEBKNOSSOS license expired on{" "}
                <FormattedDate timestamp={expiresAt * 1000} format="YYYY-MM-DD" />.
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
