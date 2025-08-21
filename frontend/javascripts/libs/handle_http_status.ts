export type ServerErrorMessage = {
  error: string;
};

const handleStatus = (response: Response): Promise<Response> => {
  if (response.status >= 200 && response.status < 400) {
    return Promise.resolve(response);
  }
  return Promise.reject(response);
};

export default handleStatus;