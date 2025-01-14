import Request from "libs/request";

type CertificateValidationResult = {
  valid: boolean;
};

export async function isCertificateValid(): Promise<CertificateValidationResult> {
  try {
    return await Request.receiveJSON("/api/checkCertificate", { showErrorToast: false });
  } catch (_e) {
    return { valid: false };
  }
}
