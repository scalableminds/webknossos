/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// Configure babel for node. This is different than the global config for browsers.
require("babel-register")({ presets: [["env", { targets: { node: "current" } }]] });

const Jasmine = require("jasmine");

const jasmine = new Jasmine();

jasmine.loadConfig({
  spec_dir: "app/assets/javascripts/test",
  spec_files: [
    "**/*[sS]pec.js",
  ],
});

jasmine.execute();
