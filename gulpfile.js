var gulp         = require("gulp");
var less         = require("gulp-less");
var exec         = require("gulp-exec");
var chalk        = require("chalk");
var through2     = require("through2");
var path         = require("path");
var fs           = require("fs");
var webpack      = require("webpack");
var chokidar     = require("chokidar");


paths = {
  src : {
    css : __dirname + "/app/assets/stylesheets/main.less",
    dir : __dirname + "/app/assets",
    js : __dirname + "/app/assets/javascripts",
    fontawesome : __dirname + "/node_modules/font-awesome/fonts/**",
  },
  dest : {
    js : __dirname + "/public/javascripts",
    css : __dirname + "/public/stylesheets",
    fontawesome : __dirname + "/public/fonts/fontawesome",
  },
};


var nodePath = __dirname + "/node_modules/";
var scriptPaths = {
  "gzip"                  : nodePath + "zlibjs/bin/gzip.min",
  "three"                 : nodePath + "three.js/build/three",
  "three.color"           : nodePath + "three.js/examples/js/math/ColorConverter",
  "three.trackball"       : nodePath + "three.js/examples/js/controls/TrackballControls",
  "jasny-bootstrap"       : nodePath + "jasny-bootstrap/dist/js/jasny-bootstrap",
  "bootstrap-multiselect" : nodePath + "bootstrap-multiselect/dist/js/bootstrap-multiselect",
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
        { test: /\.cjsx$/, loaders: ["coffee", "cjsx"] },
        { test: scriptPaths["three.color"], loader: "imports?THREE=three!exports?THREE.ColorConverter" },
        { test: scriptPaths["three.trackball"], loader: "imports?THREE=three" },
        { test: scriptPaths["three"], loader: "exports?THREE" },
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
      extensions: ['', '.js', '.json', '.coffee', '.cjsx']
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

      // // Use lodash in place of underscore
      // new webpack.NormalModuleReplacementPlugin(/underscore/, 'lodash'),
    ]
  })
}

gulp.task("scripts", function (done) {
  makeScripts().run(function (err, stats) {
    if (err) {
      done(err);
    } else {
      if (stats.compilation.errors && stats.compilation.errors.length) {
        done(stats.compilation.errors);
      } else if (stats.compilation.assets) {
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

// FONT AWESOME
gulp.task("fontawesome", function () {
  return gulp.src(paths.src.fontawesome)
    .pipe(gulp.dest(paths.dest.fontawesome))
    .pipe(logger());
});


gulp.task("watch:styles", ["styles"], function (done) {
  chokidar.watch(paths.src.dir, { ignoreInitial: true }).on('all', function () {
    gulp.start("styles");
  });
});


// ENTRY
gulp.task("debug", ["watch:styles", "watch:scripts", "fontawesome"]);
gulp.task("build", ["styles", "scripts", "fontawesome"]);
gulp.task("default", ["build"]);

fs.writeFileSync("target/gulp.pid", process.pid, "utf8");
