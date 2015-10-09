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
    css : "app/assets/stylesheets/main.less",
    dir : "app/assets/**/*",
    js : __dirname + "/app/assets/javascripts"
  },
  dest : {
    js : __dirname + "/public/javascripts",
    css : "public/stylesheets"
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
  "tween"               : bowerPath + "tweenjs/build/Tween",
  "moment"              : bowerPath + "momentjs/moment",
  "require"             : bowerPath + "requirejs/require",
  "c3"                  : bowerPath + "c3/c3",
  "d3"                  : bowerPath + "d3/d3",
  "offcanvas"           : bowerPath + "jasny-bootstrap/js/offcanvas",
  "fileinput"           : bowerPath + "jasny-bootstrap/js/fileinput",
  "daterangepicker"     : bowerPath + "bootstrap-daterangepicker/daterangepicker",
  "rangeslider"         : bowerPath + "nouislider/distribute/nouislider.min",
  "clipboard"           : bowerPath + "clipboard/dist/clipboard.min",
  "mjs"                 : bowerPath + "mjs/src/mjs",
  "worker"              : "libs/worker_plugin",
  "wrapped_worker"      : "libs/wrapped_worker_plugin",
  "nested_obj_model"    : "libs/nested_obj_model",
};



// Helper functions
function logger() {
  return through2.obj(function (file, enc, callback) {
    console.log(">>", chalk.yellow(path.relative(process.cwd(), file.path)));
    callback(null, file);
  });
}

function handleError(err) {
  console.log(chalk.red("!!"), err.toString());
}



// DEPENDENCIES
gulp.task("install:bower", function () {
  return gulp.src("bower.json")
    .pipe(exec(path.join(process.cwd(), "node_modules", ".bin", "bower") + " install -q"));
});


// SCRIPTS
function makeScripts(watch, done) {
  webpack({
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
        { test: scriptPaths["tween"], loader: "exports?TWEEN" },
        { test: scriptPaths["gzip"], loader: "exports?this.Zlib" },
        // {
        //   test: /\.jsx?$/,
        //   exclude: /(node_modules|bower_components)/,
        //   loader: 'babel'
        // }
      ],
      noParse: [
        paths.src.js + "/libs/viz.js"
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
    plugins: [
      // new webpack.optimize.CommonsChunkPlugin('common.js'),
      // new webpack.ProvidePlugin({
      //   $: "jquery",
      // })
    ],
    devtool: "source-map",
    debug: true,
    watch: watch
  }, function (err, stats) {
    if (stats.compilation.assets) {
      Object.keys(stats.compilation.assets).forEach(function (asset) {
        console.log(">>", paths.dest.js + "/" + asset);
      })
    }
    stats.compilation.missingDependencies.forEach(function (dep) {
      console.error("Missing dependency:", dep);
    });
    done(err);
  });
}

gulp.task("scripts", ["install:bower"], function (done) {
  makeScripts(false, done);
});

gulp.task("watch:scripts", ["install:bower"], function (done) {
  makeScripts(true, function () {});
});


// STYLES
gulp.task("styles", function () {
  return gulp.src(paths.src.css)
    .pipe(less({ paths : [] }).on("error", handleError))
    .pipe(gulp.dest(paths.dest.css))
    .pipe(logger());
});


gulp.task("watch:styles", ["install:bower", "styles"], function (done) {
  gulp.watch(paths.src.dir + "/**/*", ["styles"]);
});


// ENTRY
gulp.task("debug", ["watch:styles", "watch:scripts"]);
gulp.task("build", ["install:bower", "styles", "scripts"]);
gulp.task("default", ["build"]);

fs.writeFileSync("target/gulp.pid", process.pid, "utf8");
