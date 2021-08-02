// @noflow
import _ from "lodash";
import test from "ava";
import { validateObjectWithType } from "types/validation";
import { enforceValidatedDatasetViewConfiguration } from "types/schemas/dataset_view_configuration_defaults";
import DATASET from "test/fixtures/dataset_server_object";

const datasetViewConfigurationType = "types::DatasetViewConfiguration";

const CORRECT_DATASET_CONFIGURATION = {
  fourBit: false,
  interpolation: true,
  renderMissingDataBlack: true,
  loadingStrategy: "PROGRESSIVE_QUALITY",
  segmentationPatternOpacity: 40,
  layers: {},
};

test("Validator should report no errors for valid configuration (without optional values)", t => {
  t.is(
    validateObjectWithType(datasetViewConfigurationType, CORRECT_DATASET_CONFIGURATION).length,
    0,
  );
});

test("Validator should report no errors for valid configuration (with optional values)", t => {
  const validConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  validConfiguration.zoom = 3;
  validConfiguration.position = [1, 1, 1];
  validConfiguration.rotation = [1, 1, 1];
  t.is(
    validateObjectWithType(datasetViewConfigurationType, CORRECT_DATASET_CONFIGURATION).length,
    0,
  );
});

test("Validator should report 1 error for additional property", t => {
  const additionalPropertiesObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  additionalPropertiesObject.additionalProperty = 1;
  t.is(validateObjectWithType(datasetViewConfigurationType, additionalPropertiesObject).length, 1);
});

test("Validator should report 1 error for missing property", t => {
  const missingPropertiesObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  delete missingPropertiesObject.layers;
  t.is(validateObjectWithType(datasetViewConfigurationType, missingPropertiesObject).length, 1);
});

test("Validator should report 1 error for wrong type", t => {
  const wrongTypeObject = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  wrongTypeObject.fourBit = 1;
  t.is(validateObjectWithType(datasetViewConfigurationType, wrongTypeObject).length, 1);
});

test("validated view configuration should report no errors", t => {
  const validatedConfiguration = {};
  enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);
  t.is(validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length, 0);
});

test("validated view configuration should remove additional properties", t => {
  const validatedConfiguration = { additionalProperty: 1 };
  enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);
  t.is(validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length, 0);
});

test("validated view configuration should not add missing property, when optional", t => {
  const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  delete validatedConfiguration.fourBit;
  enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, true);
  t.is(validatedConfiguration.fourBit === undefined, true);
});

test("validated should correctly remove nested additional property for known field", t => {
  const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  validatedConfiguration.fourBit = { deeply: "nested" };
  enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);
  t.is(validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length, 0);
});

test("validated should correctly remove nested additional property for unknown field", t => {
  const validatedConfiguration = _.cloneDeep(CORRECT_DATASET_CONFIGURATION);
  validatedConfiguration.test = { deeply: "nested" };
  enforceValidatedDatasetViewConfiguration(validatedConfiguration, DATASET, false);
  t.is(validateObjectWithType(datasetViewConfigurationType, validatedConfiguration).length, 0);
});
