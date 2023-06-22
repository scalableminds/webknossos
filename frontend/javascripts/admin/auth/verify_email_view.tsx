import { Spin } from "antd";
import React, { useEffect } from "react";
import { useFetch } from "libs/react_helpers";
import { requestVerificationMail, verifyEmail } from "admin/admin_rest_api";
import Toast from "libs/toast";
import { AsyncButton } from "components/async_clickables";
import { ServerErrorMessage } from "libs/request";

export default function VerifyEmailView({ token }: { token: string }) {
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
      Toast.error(
        <>
          {errorMessage}{" "}
          <AsyncButton style={{ display: "inline" }} type="link" onClick={requestVerificationMail}>
            Resend verification email.
          </AsyncButton>
        </>,
      );
    }
    // An error toast will be automatically shown by the Request
    // module.
    if (result || exception) {
      console.log("redirect");
    }
  }, [result, exception]);
  return (
    <div style={{ display: "flex", justifyContent: "center", marginTop: 64 }}>
      <Spin size="large" spinning />
    </div>
  );
}
