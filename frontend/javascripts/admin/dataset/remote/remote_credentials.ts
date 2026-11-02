import type { UploadFile } from "antd";
import { readFileAsText } from "libs/read_file";
import type { RemoteStorage } from "./remote_url_utils";

export type HttpsAuthMode = "basic" | "token";

export type RemoteCredentialsInput = {
  usernameOrAccessKey: string;
  passwordOrSecretKey: string;
  // Only offered to super users for HTTPS URLs.
  httpsAuthMode: HttpsAuthMode;
  xAuthToken: string;
  serviceAccountKeyFiles: UploadFile[];
};

export const EMPTY_CREDENTIALS: RemoteCredentialsInput = {
  usernameOrAccessKey: "",
  passwordOrSecretKey: "",
  httpsAuthMode: "basic",
  xAuthToken: "",
  serviceAccountKeyFiles: [],
};

export type ExploreCredentials = { username: string; pass: string };

export function getCredentialsLinkLabel(storage: RemoteStorage | null): string {
  if (storage === "s3") return "Private bucket? Add access keys";
  if (storage === "gs") return "Private bucket? Add a service account key";
  return "Protected? Add credentials";
}

export function getCredentialsTitle(storage: RemoteStorage | null): string {
  if (storage === "s3") return "Amazon S3 access keys";
  if (storage === "gs") return "Google service account key";
  return "Basic authentication";
}

export function getCredentialFieldLabels(storage: RemoteStorage | null) {
  return storage === "s3"
    ? { username: "Access key ID", password: "Secret access key" }
    : { username: "Username", password: "Password" };
}

async function readServiceAccountKey(file: UploadFile): Promise<string> {
  if (file.originFileObj == null) throw new Error("The service account key could not be read.");
  try {
    return JSON.stringify(JSON.parse(await readFileAsText(file.originFileObj)));
  } catch (_exception) {
    throw new Error("The service account key is not a valid JSON file.");
  }
}

// Returns null if no complete set of credentials was entered for the storage.
export async function buildExploreCredentials(
  storage: RemoteStorage | null,
  input: RemoteCredentialsInput,
): Promise<ExploreCredentials | null> {
  if (storage === "gs") {
    const keyFile = input.serviceAccountKeyFiles[0];
    return keyFile != null ? { username: "", pass: await readServiceAccountKey(keyFile) } : null;
  }
  if (storage === "https" && input.httpsAuthMode === "token") {
    return input.xAuthToken !== "" ? { username: "", pass: input.xAuthToken } : null;
  }
  if (input.usernameOrAccessKey !== "" && input.passwordOrSecretKey !== "") {
    return { username: input.usernameOrAccessKey, pass: input.passwordOrSecretKey };
  }
  return null;
}
