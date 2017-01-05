/* eslint no-var:0 */
var webpack = require("webpack");
var ExtractTextPlugin = require("extract-text-webpack-plugin");
var fs = require("fs");
var path = require("path");

var srcPath = path.resolve(__dirname, "app/assets/javascripts/");
var nodePath = __dirname + "/node_modules/";
var scriptPaths = {
  "three"                 : nodePath + "three.js/build/three",
  "three.color"           : nodePath + "three.js/examples/js/math/ColorConverter",
  "three.trackball"       : nodePath + "three.js/examples/js/controls/TrackballControls",
  "jasny-bootstrap"       : nodePath + "jasny-bootstrap/dist/js/jasny-bootstrap",
  "bootstrap-multiselect" : nodePath + "bootstrap-multiselect/dist/js/bootstrap-multiselect",
};

module.exports = {
  entry: {
    main: "main.js",
  },
  output: {
    path:              __dirname + "/public/bundle",
    filename:          "[name].js",
    sourceMapFilename: "[file].map",
    publicPath:        "/assets/bundle/"
  },
  module: {
    // Reduce compilation time by telling webpack to not parse these libraries.
    // Only add libraries that have no dependencies eg. no require, define or similar calls.
    noParse: [
      /lodash/,
      /\/jquery\//,
    ],
    rules: [{
      test: /\.js$/,
      exclude: /(node_modules|bower_components)/,
      use: "babel-loader",
    }, {
      test: scriptPaths["three.color"],
      use: [{
        loader: "imports-loader",
        options: { "THREE": "three" },
      }, {
        loader: "exports-loader",
        options: { "THREE.ColorConverter": "THREE.ColorConverter" },
      }],
    }, {
      test: scriptPaths["three.trackball"],
      use: { loader: "imports-loader", options: { "THREE": "three" } },
    }, {
      test: scriptPaths["three"],
      use: { loader: "exports-loader", options: { "THREE": "THREE" } },
    },
    { test: /\.css$/, use: "css-loader" },
    { test: /\.less$/, use: ["style-loader", "css-loader", "less-loader"] },
    {
      test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
      use: {
        loader: "url-loader",
        options: {
          limit: 10000,
          mimetype: "application/font-woff",
        },
      },
    }, {
      test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
      use: "file-loader",
    },
    { test: /\.png$/, use: { loader: "url-loader", options: { limit: 100000 } } },
    { test: /\.jpg$/, use: "file-loader" },
  ]},
  resolve: {
    modules: [
      srcPath,
      nodePath,
    ],
    alias: scriptPaths,
  },
  externals: [
    { "routes": "var jsRoutes" }
  ],
  plugins: [
    new webpack.DefinePlugin({
      "process.env": {
        NODE_ENV: process.env.NODE_ENV ? JSON.stringify(process.env.NODE_ENV) : undefined,
      },
    }),
    new webpack.ProvidePlugin({
      $ : "jquery",
      jQuery : "jquery",
      "window.jQuery" : "jquery",
      _ : "lodash"
    }),
  ]
};

fs.writeFileSync("target/webpack.pid", process.pid, "utf8");
