// @flow

import jsonschema from "jsonschema";
import DatasourceSchema from "libs/datasource.schema.json";

const validator = new jsonschema.Validator();
validator.addSchema(DatasourceSchema, "/");

const validateWithSchema = (type: string) => (rule: Object, value: Object, callback: Function) => {
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

export const validateDatasourceJSON = validateWithSchema("types::DatasourceConfiguration");
export const validateLayerConfigurationJSON = validateWithSchema("types::LayerUserConfiguration");

export const isValidJSON = json => {
  try {
    JSON.parse(json);
    return true;
  } catch (ex) {
    return false;
  }
};
