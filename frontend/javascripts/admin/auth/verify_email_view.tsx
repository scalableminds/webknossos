import { requestVerificationMail, verifyEmail } from "admin/rest_api";
import { Spin } from "antd";
import { useFetch } from "libs/react_helpers";
import type { ServerErrorMessage } from "libs/request";
import Toast from "libs/toast";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Store } from "viewer/singletons";

export const VERIFICATION_ERROR_TOAST_KEY = "verificationError";

export const handleResendVerificationEmail = async () => {
  const { activeUser } = Store.getState();
  if (activeUser) {
    await requestVerificationMail();
  } else {
    Toast.error("Resending a verification link requires being logged in.");
  }
  Toast.close(VERIFICATION_ERROR_TOAST_KEY);
};

function showVerificationErrorToast(errorMessage: string) {
  Toast.error(
    <>
      {errorMessage}{" "}
      <a href="#" type="link" onClick={handleResendVerificationEmail}>
        Resend verification email.
      </a>
    </>,
    { sticky: true, key: VERIFICATION_ERROR_TOAST_KEY },
  );
}

export function showVerificationReminderToast() {
  Toast.warning(
    <>
      Your email address is not verified yet. Please check your emails or{" "}
      <a href="#" type="link" onClick={handleResendVerificationEmail}>
        resend the verification email
      </a>{" "}
      to avoid being locked out.
    </>,
    { key: VERIFICATION_ERROR_TOAST_KEY, sticky: true },
  );
}

export default function VerifyEmailView({ token }: { token: string }) {
  const navigate = useNavigate();
  const [result, exception] = useFetch(
    async () => {
      try {
        return [await verifyEmail(token), null];
      } catch (exc) {
        return [null, exc];
      }
    },
    [null, null],
    [token],
  );

  useEffect(() => {
    Toast.close(VERIFICATION_ERROR_TOAST_KEY);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: history.push is not needed as a dependency.
  useEffect(() => {
    if (result) {
      Toast.success("Successfully verified your email.");
    }
    if (exception) {
      let errorMessage;
      if (typeof exception === "object" && "messages" in exception) {
        errorMessage = ((exception as any).messages as ServerErrorMessage[])
          .map((m: any) => m.error || "")
          .join(" ");
      }
      errorMessage = errorMessage || "Verification failed.";

      showVerificationErrorToast(errorMessage);
    }

    if (result || exception) {
      navigate("/");
    }
  }, [result, exception]);
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 64 }}>
      <Spin size="large" spinning />
    </div>
  );
}
