/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
require("babel-register");

const Jasmine = require("jasmine");

const jasmine = new Jasmine();

jasmine.loadConfig({
  spec_dir: "app/assets/javascripts/test",
  spec_files: [
    "**/*[sS]pec.js",
  ],
});

jasmine.execute();
