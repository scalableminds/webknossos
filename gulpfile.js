var gulp         = require("gulp");
var less         = require("gulp-less");
var exec         = require("gulp-exec");
var chalk        = require("chalk");
var through2     = require("through2");
var path         = require("path");
var fs           = require("fs");
var webpack      = require("webpack");

paths = {
  src : {
    css : __dirname + "/app/assets/stylesheets/main.less",
    dir : __dirname + "/app/assets/**/*",
    js : __dirname + "/app/assets/javascripts"
  },
  dest : {
    js : __dirname + "/public/javascripts",
    css : __dirname + "/public/stylesheets"
  }
};


var bowerPath = __dirname + "/public/bower_components/";
var scriptPaths = {
  "jquery"              : bowerPath + "jquery/jquery",
  "lodash"              : bowerPath + "lodash/dist/lodash",
  "underscore"          : bowerPath + "underscore/underscore",
  "bootstrap"           : bowerPath + "bootstrap/dist/js/bootstrap",
  "coffee-script"       : bowerPath + "coffee-script/extras/coffee-script",
  "backbone.marionette" : bowerPath + "backbone.marionette/lib/backbone.marionette",
  "backbone.paginator"  : bowerPath + "backbone.paginator/dist/backbone.paginator",
  "backbone.subviews"   : bowerPath + "backbone.subviews/index",
  "backbone-deep-model" : bowerPath + "backbone-deep-model/distribution/deep-model",
  "backbone"            : bowerPath + "backbone/backbone",
  "gzip"                : bowerPath + "zlib/bin/gzip.min",
  "three"               : bowerPath + "three/index",
  "three.color"         : bowerPath + "ColorConverter/index",
  "three.trackball"     : bowerPath + "TrackballControls/index",
  "stats"               : bowerPath + "threejs-stats/Stats",
  "ace"                 : bowerPath + "ace-builds/src-min-noconflict/ace",
  "keyboard"            : bowerPath + "KeyboardJS/keyboard",
  "gamepad"             : bowerPath + "gamepad.js/gamepad",
  "jquery.mousewheel"   : bowerPath + "jquery-mousewheel/jquery.mousewheel",
  "tween"               : bowerPath + "tweenjs/src/Tween",
  "moment"              : bowerPath + "momentjs/moment",
  "require"             : bowerPath + "requirejs/require",
  "c3"                  : bowerPath + "c3/c3",
  "d3"                  : bowerPath + "d3/d3",
  "cola"                : bowerPath + "webcola/WebCola/cola",
  "offcanvas"           : bowerPath + "jasny-bootstrap/js/offcanvas",
  "fileinput"           : bowerPath + "jasny-bootstrap/js/fileinput",
  "daterangepicker"     : bowerPath + "bootstrap-daterangepicker/daterangepicker",
  "rangeslider"         : bowerPath + "nouislider/distribute/nouislider",
  "clipboard"           : bowerPath + "clipboard/dist/clipboard",
  "mjs"                 : bowerPath + "mjs/src/mjs",
  "nested_obj_model"    : "libs/nested_obj_model",
};


// Helper functions
function logger() {
  return through2.obj(function (file, enc, callback) {
    logFile(file.path);
    callback(null, file);
  });
}
function logFile(filepath) {
  console.log(">>", chalk.yellow(path.relative(process.cwd(), filepath)));
}

function handleError(err) {
  console.error(err.toString());
}


// SCRIPTS
function makeScripts() {
  return webpack({
    entry: {
      main: paths.src.js + "/main.coffee"
    },
    output: {
      path:              paths.dest.js,
      filename:          "[name].js",
      sourceMapFilename: "[file].map",
      publicPath:        "/assets/javascripts/"
    },
    module: {
      loaders: [
        { test: /\.coffee$/, loader: "coffee-loader" },
        { test: scriptPaths["three.color"], loader: "imports?THREE=three!exports?THREE.ColorConverter" },
        { test: scriptPaths["three.trackball"], loader: "imports?THREE=three" },
        { test: scriptPaths["three"], loader: "exports?THREE" },
        { test: scriptPaths["backbone-deep-model"], loader: "imports?_=underscore" },
        { test: scriptPaths["stats"], loader: "exports?Stats" },
        { test: scriptPaths["gzip"], loader: "exports?this.Zlib" },
        // {
        //   test: /\.jsx?$/,
        //   exclude: /(node_modules|bower_components)/,
        //   loader: 'babel'
        // }
      ]
    },
    resolve: {
      root: paths.src.js,
      alias: scriptPaths,
      extensions: ['', '.js', '.json', '.coffee']
    },
    externals: [
      { "routes": "var jsRoutes" }
    ],
    devtool: "source-map",
    debug: true
  })
}

gulp.task("scripts", function (done) {
  makeScripts().run(function (err, stats) {
    if (err) {
      done(err);
    } else {
      if (stats.compilation.assets) {
        Object.keys(stats.compilation.assets).forEach(function (asset) {
          logFile(path.join(paths.dest.js, asset));
        });
      }
    }
  });
});

gulp.task("watch:scripts", function (done) {
  makeScripts().watch(200, function (err, stats) {
    if (err) {
      console.error(err.toString());
    } else {
      if (stats.compilation.errors && stats.compilation.errors.length) {
        stats.compilation.errors.forEach(function (err) {
          console.error(err.toString());
        });
      } else if (stats.compilation.assets) {
        Object.keys(stats.compilation.assets).forEach(function (asset) {
          logFile(path.join(paths.dest.js, asset));
        });
      }
    }
  });
});


// STYLES
gulp.task("styles", function () {
  return gulp.src(paths.src.css)
    .pipe(less({ paths : [] }).on("error", handleError))
    .pipe(gulp.dest(paths.dest.css))
    .pipe(logger());
});


gulp.task("watch:styles", ["styles"], function (done) {
  gulp.watch(paths.src.dir + "/**/*", ["styles"]);
});


// ENTRY
gulp.task("debug", ["watch:styles", "watch:scripts"]);
gulp.task("build", ["styles", "scripts"]);
gulp.task("default", ["build"]);

fs.writeFileSync("target/gulp.pid", process.pid, "utf8");
