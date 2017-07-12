// @flow
// This module exposes the api for internal usage, so that we don't have to
// deal with versioning, creation and waiting of/for the api.

import createApi from "oxalis/api/api_latest";
import Model from "oxalis/model";

const api = createApi(Model);

export default api;
