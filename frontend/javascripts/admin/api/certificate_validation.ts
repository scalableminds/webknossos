import Request from "libs/request";

type CertificateValidationResult = {
  isValid: boolean;
  expiresAt: number;
};

export async function isCertificateValid(): Promise<CertificateValidationResult> {
  try {
    return await Request.receiveJSON("/api/checkCertificate", { showErrorToast: false });
  } catch (errorResponse: any) {
    if (errorResponse.status !== 400) {
      // In case the server is not available or some other kind of error occurred, we assume the certificate is valid.
      return { isValid: true, expiresAt: 0 };
    }
    try {
      const { isValid, expiresAt } = JSON.parse(errorResponse.errors[0]);
      return { isValid, expiresAt };
    } catch (_e) {
      // If parsing the error message fails, we assume the certificate is valid.
      return { isValid: true, expiresAt: 0 };
    }
  }
}
