// @flow

import jsonschema from "jsonschema";

import DatasourceSchema from "types/schemas/datasource.schema.json";
import UserSettingsSchema from "types/schemas/user_settings.schema";
import ViewConfigurationSchema from "types/schemas/dataset_view_configuration.schema";

const validator = new jsonschema.Validator();
validator.addSchema(DatasourceSchema, "/");
validator.addSchema(UserSettingsSchema, "/");
validator.addSchema(ViewConfigurationSchema, "/");

const validateWithSchema = (type: string) => (rule: Object, value: string, callback: Function) => {
  try {
    const json = JSON.parse(value);
    const result = validator.validate(json, {
      $ref: `#/definitions/${type}`,
    });
    if (result.valid) {
      callback();
    } else {
      callback(
        new Error(
          `Invalid schema: ${result.errors.map(e => `${e.property} ${e.message}`).join("; ")}`,
        ),
      );
    }
  } catch (e) {
    callback(new Error(`Invalid JSON: ${e.message}`));
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
export const validateUserSettingsJSON = validateWithSchema("types::UserSettings");
export const validateLayerViewConfigurationObjectJSON = validateWithSchema("types::LayerViewConfigurationObject");

export const isValidJSON = (json: string) => {
  try {
    JSON.parse(json);
    return true;
  } catch (ex) {
    return false;
  }
};

export function syncValidator<T>(validateValueFn: T => boolean, errMessage: string) {
  return (rule: Object, value: T, callback: Function) =>
    validateValueFn(value) ? callback() : callback(new Error(errMessage));
}
