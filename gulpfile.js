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


var nodePath = __dirname + "/node_modules/";
var scriptPaths = {
  "boostrap"            : nodePath + "boostrap/dist/boostrap",
  "backbone.wreqr"      : nodePath + "backbone.marionette/node_modules/backbone.wreqr/lib/backbone.wreqr.js",
  "backbone.paginator"  : nodePath + "backbone.paginator/lib/backbone.paginator",
  "backbone.subviews"   : nodePath + "backbone.subviews/index",
  "backbone-deep-model" : nodePath + "backbone-deep-model/distribution/deep-model",
  "gzip"                : nodePath + "zlibjs/bin/gzip.min",
  "three"               : nodePath + "three.js/build/three",
  "three.color"         : nodePath + "three.js/examples/js/math/ColorConverter",
  "three.trackball"     : nodePath + "three.js/examples/js/controls/TrackballControls",
  "jasny-bootstrap"     : nodePath + "jasny-bootstrap/dist/js/jasny-bootstrap",
  "jQuery"              : nodePath + "jquery/dist/jquery",
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
      // Reduce compilation time by telling webpack to not parse these libraries.
      // Only add libraries that have no dependencies eg. no require, define or similar calls.
      noParse: [
        /lodash/,
        /jquery/,
      ],
      loaders: [
        { test: /\.coffee$/, loader: "coffee-loader" },
        //{ test: scriptPaths["backbone.marionette"], loader: "imports?backbone.wreqr" },
        { test: scriptPaths["three.color"], loader: "imports?THREE=three!exports?THREE.ColorConverter" },
        { test: scriptPaths["three.trackball"], loader: "imports?THREE=three" },
        { test: scriptPaths["three"], loader: "exports?THREE" },
        { test: scriptPaths["backbone-deep-model"], loader: "imports?_=underscore" },
        //{ test: scriptPaths["stats"], loader: "exports?Stats" },
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
    debug: true,
    plugins: [
      new webpack.ProvidePlugin({
        $ : "jquery",
        jQuery : "jquery",
        "window.jQuery" : "jquery",
        _ : "lodash"
      }),

      // Use lodash in place of underscore
      //new webpack.NormalModuleReplacementPlugin(/underscore/, 'lodash'),
    ]
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
