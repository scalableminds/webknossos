import { useQuery } from "@tanstack/react-query";
import { isCertificateValid } from "admin/api/certificate_validation";
import { Col, Modal, Result, Row } from "antd";
import noop from "lodash-es/noop";
import { ModalWidth } from "theme";
import FormattedDate from "./formatted_date";

export function CheckCertificateModal() {
  // isCertificateValid never throws, so no error handling is needed.
  const { data: { isValid, expiresAt } = { isValid: true, expiresAt: Number.POSITIVE_INFINITY } } =
    useQuery({
      queryKey: ["certificateValidity"],
      queryFn: isCertificateValid,
      refetchInterval: 5 * 60 * 1000, // 5 minutes
      refetchIntervalInBackground: true,
      refetchOnWindowFocus: false,
      // Don't show a stale license state from a previous session.
      meta: { persist: false },
    });
  if (isValid) {
    return null;
  }
  return (
    <Modal
      open={true}
      closable={false}
      footer={null}
      onCancel={noop}
      width={ModalWidth.Full}
      keyboard={false}
      mask={{ closable: false }}
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
                  href="mailto:support@webknossos.org"
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
