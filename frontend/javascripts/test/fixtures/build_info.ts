import type { APIBuildInfoWk } from "types/api_types";

export const buildInfo: APIBuildInfoWk = {
  webknossos: {
    name: "webknossos",
    ciTag: "",
    commitHash: "fc0ea6432ec7107e8f9b5b308ee0e90eae0e7b17",
    ciBuild: "23138",
    scalaVersion: "2.12.15",
    version: "23138",
    sbtVersion: "1.6.2",
    datastoreApiVersion: "2.0",
    commitDate: "Tue May 23 10:24:41 2023 +0200",
  },
  "webknossos-wrap": {
    builtAtMillis: "1640035836569",
    name: "webknossos-wrap",
    commitHash: "8b842648702f469a3ffd90dc8a68c4310e64b351",
    scalaVersion: "2.12.7",
    version: "1.1.15",
    sbtVersion: "1.4.1",
    builtAtString: "2021-12-20 21:30:36.569",
  },
  httpApiVersioning: { currentApiVersion: 9, oldestSupportedApiVersion: 5 },
  schemaVersion: 101,
  localDataStoreEnabled: false,
  localTracingStoreEnabled: true,
};
