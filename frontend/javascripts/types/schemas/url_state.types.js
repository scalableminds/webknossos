// @flow
// This file is only for documentation:
// Types which were used for creating the url_state.schema.js
// The `flow2schema` node module has been used for conversion.
// Unfortunately as of now, flow2schema doesn't support our code
// base out of the box so all types need to be temporarily copied into
// this file as imports do not work!
//
// Please note that some manual changes to the schema are required,
// i.e. the ::path::to::definition:: prefixes need to be removed
// and "additionalProperties: false," needs to be added to the objects
// to make the object types exact and forbid superfluous properties.

import { type UrlManagerState } from "oxalis/controller/url_manager";

/* eslint-disable-next-line import/prefer-default-export */
export type { UrlManagerState };
