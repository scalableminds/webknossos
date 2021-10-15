// @flow

import jsonschema from "jsonschema";

import DatasourceSchema from "types/schemas/datasource.schema";
import UserSettingsSchema from "types/schemas/user_settings.schema";
import ViewConfigurationSchema from "types/schemas/dataset_view_configuration.schema";
import UrlStateSchema from "types/schemas/url_state.schema";

const validator = new jsonschema.Validator();
validator.addSchema(DatasourceSchema, "/");
validator.addSchema(UserSettingsSchema, "/");
validator.addSchema(ViewConfigurationSchema, "/");
validator.addSchema(UrlStateSchema, "/");

const validateWithSchemaSync = (type: string, value: string) => {
  try {
    const json = JSON.parse(value);
    const result = validator.validate(json, {
      $ref: `#/definitions/${type}`,
    });
    if (result.valid) {
      return json;
    } else {
      throw new Error(
        `Invalid schema: ${result.errors.map(e => `${e.property} ${e.message}`).join("; ")}`,
      );
    }
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
};

const validateWithSchema = (type: string) => (rule: Object, value: string) => {
  try {
    return Promise.resolve(validateWithSchemaSync(type, value));
  } catch (e) {
    return Promise.reject(e);
  }
};

export const validateObjectWithType = (type: string, json: Object) => {
  const result = validator.validate(json, {
    $ref: `#/definitions/${type}`,
  });
  if (result.valid) {
    return [];
  } else {
    return result.errors;
  }
};

export const validateDatasourceJSON = validateWithSchema("types::DatasourceConfiguration");
export const isDatasourceJSONValid = (json: Object) =>
  validator.validate(json, {
    $ref: "#/definitions/types::DatasourceConfiguration",
  }).valid;
export const validateUserSettingsJSON = validateWithSchema("types::UserSettings");
export const validateLayerViewConfigurationObjectJSON = validateWithSchema(
  "types::LayerViewConfigurationObject",
);
export const validateUrlStateJSON = (value: string) =>
  validateWithSchemaSync("types::UrlManagerState", value);

export const isValidJSON = (json: string) => {
  try {
    JSON.parse(json);
    return true;
  } catch (ex) {
    return false;
  }
};

export function syncValidator<T>(validateValueFn: T => boolean, errMessage: string) {
  return (rule: Object, value: T) =>
    validateValueFn(value) ? Promise.resolve() : Promise.reject(new Error(errMessage));
}
