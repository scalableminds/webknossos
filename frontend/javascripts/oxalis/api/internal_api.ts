import createApi from "oxalis/api/api_latest";
// This module exposes the api for internal usage, so that we don't have to
// deal with versioning, creation and waiting of/for the api.
import { Model, setApi } from "oxalis/singletons";

export function setupApi() {
  const api = createApi(Model);
  setApi(api);
}
