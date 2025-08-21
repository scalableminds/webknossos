import { Button } from "antd";
import { showToastOnce } from "./toast";

const handleStatus = (response: Response): Promise<Response> => {
  if (response.status >= 200 && response.status < 400) {
    return Promise.resolve(response);
  }
  if (response.status === 401) {
    showToastOnce(
      "error",
      <>
        <span>Your session has expired. Please refresh the page</span>
        <Button onClick={() => window.location.reload()}>Refresh</Button>
      </>,
      { timeout: 10000, sticky: true },
    );
  }
  return Promise.reject(response);
};

export default handleStatus;
