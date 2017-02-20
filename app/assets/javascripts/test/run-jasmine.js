/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// Configure babel for node. This is different than the global config for browsers.
require("babel-register")({ presets: [["env", { targets: { node: "current" } }]] });

const Jasmine = require("jasmine");
const SpecReporter = require("jasmine-spec-reporter").SpecReporter;

const jasmine = new Jasmine();

jasmine.loadConfig({
  spec_dir: "app/assets/javascripts",
  spec_files: [
    "test/**/*[sS]pec.js",
  ],
});
jasmine.addReporter(new SpecReporter({ spec: { displayPending: true } }));

jasmine.execute();
