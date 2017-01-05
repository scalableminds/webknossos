require("babel-register");

var Jasmine = require("jasmine")

var jasmine = new Jasmine()

jasmine.loadConfig({
    spec_dir: "app/assets/javascripts/test",
    spec_files: [
        "**/*[sS]pec.js",
    ],
});

jasmine.execute();
