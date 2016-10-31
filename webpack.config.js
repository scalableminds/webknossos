/* eslint no-var:0 */
var webpack = require('webpack');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var fs = require("fs");

var srcPath = __dirname + "/app/assets/javascripts/";
var nodePath = __dirname + "/node_modules/";
var scriptPaths = {
  "gzip"                  : nodePath + "zlibjs/bin/gzip.min",
  "three"                 : nodePath + "three.js/build/three",
  "three.color"           : nodePath + "three.js/examples/js/math/ColorConverter",
  "three.trackball"       : nodePath + "three.js/examples/js/controls/TrackballControls",
  "jasny-bootstrap"       : nodePath + "jasny-bootstrap/dist/js/jasny-bootstrap",
  "bootstrap-multiselect" : nodePath + "bootstrap-multiselect/dist/js/bootstrap-multiselect",
};


module.exports = {
  entry: {
    main: srcPath + "main.coffee",
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
    loaders: [
      { test: /\.coffee$/, loader: "coffee-loader" },
      { test: /\.cjsx$/, loaders: ["coffee", "cjsx"] },
      { test: scriptPaths["three.color"], loader: "imports?THREE=three!exports?THREE.ColorConverter" },
      { test: scriptPaths["three.trackball"], loader: "imports?THREE=three" },
      { test: scriptPaths["three"], loader: "exports?THREE" },
      { test: scriptPaths["gzip"], loader: "exports?this.Zlib" },
      {
        test: /\.less$/,
        loader: ExtractTextPlugin.extract('style-loader', 'css-loader!less-loader'),
      },
      {
        test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
        loader: 'url-loader?limit=10000&minetype=application/font-woff',
      },
      {
        test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
        loader: 'file-loader',
      },
      { test: /\.png$/, loader: "url-loader?limit=100000" },
      { test: /\.jpg$/, loader: "file-loader" },
      // {
      //   test: /\.jsx?$/,
      //   exclude: /(node_modules|bower_components)/,
      //   loader: 'babel'
      // }
    ]
  },
  resolve: {
    root: srcPath,
    alias: scriptPaths,
    extensions: ['', '.js', '.json', '.coffee', '.cjsx']
  },
  externals: [
    { "routes": "var jsRoutes" }
  ],
  // devtool: "source-map",
  // debug: true,
  plugins: [
    new webpack.DefinePlugin({
      'process.env': {
        NODE_ENV: process.env.NODE_ENV ? JSON.stringify(process.env.NODE_ENV) : undefined,
      },
    }),
    new ExtractTextPlugin('main.css'),
    new webpack.ProvidePlugin({
      $ : "jquery",
      jQuery : "jquery",
      "window.jQuery" : "jquery",
      _ : "lodash"
    }),
  ]
};

fs.writeFileSync("target/webpack.pid", process.pid, "utf8");
