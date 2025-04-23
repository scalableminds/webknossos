import jsonschema from "jsonschema";
import ViewConfigurationSchema from "types/schemas/dataset_view_configuration.schema";
import DatasourceSchema from "types/schemas/datasource.schema";
import UrlStateSchema from "types/schemas/url_state.schema";
import UserSettingsSchema from "types/schemas/user_settings.schema";

const validator = new jsonschema.Validator();
// @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ definitions: { "types::Vector3... Remove this comment to see the full error message
validator.addSchema(DatasourceSchema, "/");
validator.addSchema(UserSettingsSchema, "/");
validator.addSchema(ViewConfigurationSchema, "/");
validator.addSchema(UrlStateSchema, "/");

const validateWithSchemaSync = (type: string, value: string) => {
  try {
    const json = JSON.parse(value);
    const result = validator.validate(
      json,
      {
        $ref: `#/definitions/${type}`,
      },
      { nestedErrors: true },
    );

    if (result.valid) {
      return json;
    } else {
      throw new Error(
        `${result.toString()}. Note that in case of multiple errors, it might be sufficient to only fix one of them.`,
      );
    }
  } catch (e) {
    // @ts-ignore
    throw new Error(`Invalid JSON: ${e.message}`);
  }
};

const validateWithSchema = (type: string) => (_rule: Record<string, any>, value: string) => {
  try {
    return Promise.resolve(validateWithSchemaSync(type, value));
  } catch (e) {
    return Promise.reject(e);
  }
};

export const validateObjectWithType = (type: string, json: Record<string, any>) => {
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

export const isDatasourceJSONValid = (json: Record<string, any>) =>
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
  } catch (_ex) {
    return false;
  }
};

export function syncValidator<T>(validateValueFn: (arg0: T) => boolean, errMessage: string) {
  return (_rule: Record<string, any>, value: T) =>
    validateValueFn(value) ? Promise.resolve() : Promise.reject(new Error(errMessage));
}
