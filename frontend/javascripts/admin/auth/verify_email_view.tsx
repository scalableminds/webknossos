import { Spin } from "antd";
import React, { useEffect } from "react";
import { useFetch } from "libs/react_helpers";
import { requestVerificationMail, verifyEmail } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { ServerErrorMessage } from "libs/request";
import { useHistory } from "react-router-dom";
import { Store } from "oxalis/singletons";

const VERIFICATION_ERROR_TOAST_KEY = "verificationError";

export default function VerifyEmailView({ token }: { token: string }) {
  const history = useHistory();
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
    console.log("exception", exception);
    console.log("result", result);
    if (result) {
      Toast.success("Successfully verified your email.");
    }
    if (exception) {
      let errorMessage;
      if ("messages" in exception) {
        errorMessage = ((exception as any).messages as ServerErrorMessage[])
          .map((m: any) => m.error || "")
          .join(" ");
      }
      errorMessage = errorMessage || "Verification failed.";
      const handleResend = async () => {
        const { activeUser } = Store.getState();
        if (activeUser) {
          await requestVerificationMail();
        } else {
          Toast.error("Resending a verification link requires being logged in.");
        }
        Toast.close(VERIFICATION_ERROR_TOAST_KEY);
      };
      Toast.error(
        <>
          {errorMessage}{" "}
          <a href="#" type="link" onClick={handleResend}>
            Resend verification email.
          </a>
        </>,
        { sticky: true, key: VERIFICATION_ERROR_TOAST_KEY },
      );
    }

    if (result || exception) {
      history.push("/");
    }
  }, [result, exception]);
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 64 }}>
      <Spin size="large" spinning />
    </div>
  );
}
