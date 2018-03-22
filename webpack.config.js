module.exports = function(env = {}) {
  /* eslint no-var:0, import/no-extraneous-dependencies:0 */
  var webpack = require("webpack");
  var fs = require("fs");
  var path = require("path");
  const CircularDependencyPlugin = require("circular-dependency-plugin");
  const UglifyJsPlugin = require("uglifyjs-webpack-plugin");
  const MiniCssExtractPlugin = require("mini-css-extract-plugin");

  var srcPath = path.resolve(__dirname, "app/assets/javascripts/");
  var nodePath = path.join(__dirname, "node_modules/");

  fs.writeFileSync(path.join(__dirname, "target", "webpack.pid"), process.pid, "utf8");

  const plugins = [
    new webpack.DefinePlugin({
      "process.env.NODE_ENV": env.production ? '"production"' : '"development"',
    }),
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
    new MiniCssExtractPlugin({
      filename: "[name].css",
      chunkFilename: "[name].css",
    }),
    new CircularDependencyPlugin({
      // exclude detection of files based on a RegExp
      exclude: /a\.js|node_modules/,
      // add errors to webpack instead of warnings
      failOnError: true,
      // set the current working directory for displaying module paths
      cwd: process.cwd(),
    }),
  ];

  if (env.production) {
    plugins.push(
      new UglifyJsPlugin({
        cache: true,
        parallel: true,
        sourceMap: true,
        uglifyOptions: {
          compress: {
            inline: 1,
          },
        },
      }),
    );
  }

  return {
    entry: {
      main: "main.js",
    },
    mode: env.production ? "production" : "development",
    output: {
      path: `${__dirname}/public/bundle`,
      filename: "[name].js",
      sourceMapFilename: "[file].map",
      publicPath: "/assets/bundle/",
    },
    module: {
      rules: [
        {
          test: /\.js$/,
          exclude: /(node_modules|bower_components)/,
          use: "babel-loader",
        },
        {
          test: /\.less$/,
          use: [MiniCssExtractPlugin.loader, "css-loader", "less-loader"],
        },
        {
          test: /\.css$/,
          use: [MiniCssExtractPlugin.loader, "css-loader", "less-loader"],
        },
        {
          test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          use: {
            loader: "url-loader",
            options: {
              limit: 10000,
              mimetype: "application/font-woff",
            },
          },
        },
        {
          test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          use: "file-loader",
        },
        { test: /\.png$/, use: { loader: "url-loader", options: { limit: 100000 } } },
        { test: /\.jpg$/, use: "file-loader" },
      ],
    },
    resolve: {
      modules: [srcPath, nodePath],
    },
    optimization: {
      splitChunks: {
        chunks: "initial",
      },
    },
    // See https://webpack.js.org/configuration/devtool/
    devtool: env.production ? "source-map" : "eval-source-map",
    plugins,
  };
};
