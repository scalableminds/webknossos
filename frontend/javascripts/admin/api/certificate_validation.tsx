import Request from "libs/request";

type CertificateValidationResult = {
  isValid: boolean;
  expiresAt: number;
};

export async function isCertificateValid(): Promise<CertificateValidationResult> {
  try {
    return await Request.receiveJSON("/api/checkCertificate", { showErrorToast: false });
  } catch (errorResponse: any) {
    try {
      const { isValid, expiresAt } = JSON.parse(errorResponse.errors[0]);
      return { isValid, expiresAt };
    } catch (_e) {
      return { isValid: false, expiresAt: -1 };
    }
  }
}
