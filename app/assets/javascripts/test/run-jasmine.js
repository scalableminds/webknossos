require("babel-register")(
  {
    "presets": ["es2015", "stage-3"],
    "plugins": ["transform-class-properties", "transform-runtime"]
  }
);

var Jasmine = require("jasmine")

var jasmine = new Jasmine()

jasmine.loadConfig({
    spec_dir: "app/assets/javascripts/test",
    spec_files: [
        "**/*[sS]pec.js",
    ],
});

jasmine.execute()
