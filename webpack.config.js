module.exports = function(env = {}) {
  /* eslint no-var:0, import/no-extraneous-dependencies:0, global-require:0, func-names:0 */
  var webpack = require("webpack");
  var fs = require("fs");
  var path = require("path");
  const TerserPlugin = require("terser-webpack-plugin");
  const MiniCssExtractPlugin = require("mini-css-extract-plugin");

  // const HardSourceWebpackPlugin = require("hard-source-webpack-plugin");
  const CopyWebpackPlugin = require("copy-webpack-plugin");

  var srcPath = path.resolve(__dirname, "frontend/javascripts/");
  var nodePath = path.join(__dirname, "node_modules/");
  var protoPath = path.join(__dirname, "webknossos-tracingstore/proto/");

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
    // new HardSourceWebpackPlugin(),
    // GoldenLayout requires these libraries to be available in
    // the global scope
    new webpack.ProvidePlugin({
      React: "react",
      ReactDOM: "react-dom",
      $: "jquery",
      jQuery: "jquery",
    }),
    new CopyWebpackPlugin(
      [
        { from: "./public/tf-models/**", to: "tf-models", flatten: true },
        { from: "./public/speed-src.wasm", to: "speed-src.wasm", flatten: true },
        // { from: "./public/tf-models/speed-src.*", to: "*", flatten: true },
      ],
      {
        dot: true,
      },
    ),
  ];

  if (env.production) {
    plugins.push(
      new TerserPlugin({
        cache: true,
        parallel: true,
        sourceMap: true,
        terserOptions: {
          // compress is bugged, see https://github.com/mishoo/UglifyJS2/issues/2842
          // even inline: 1 causes bugs, see https://github.com/scalableminds/webknossos/pull/2713
          compress: false,
        },
      }),
    );
  }

  return {
    entry: {
      main: "main.js",
    },
    optimization: {
      chunkIds: "deterministic", // To keep filename consistent between different modes (for example building only)
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
        // {
        //   test: /speed-src\.js$/,
        //   loader: "exports-loader",
        // },
        // wasm files should not be processed but just be emitted and we want
        // to have their public URL.
        {
          test: /\.worker\.js$/,
          use: {
            loader: "worker-loader",
            options: {
              name: "[name].[hash].worker.js",
            },
          },
        },
        {
          test: /\.js$/,
          exclude: /(node_modules|bower_components)/,
          use: "babel-loader",
        },
        {
          test: /\.less$/,
          use: [
            MiniCssExtractPlugin.loader,
            "css-loader",
            {
              loader: "less-loader",
              options: {
                javascriptEnabled: true,
              },
            },
          ],
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            "css-loader",
            {
              loader: "less-loader",
              options: {
                javascriptEnabled: true,
              },
            },
          ],
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
        { test: /\.proto$/, loaders: ["json-loader", "proto-loader6"] },
        {
          test: /\.wasm$/,
          use: "file-loader",
        },
        {
          test: /speed-src\.js$/,
          loader: "exports-loader",
          options: {
            exports: "Module"
          }
        },
      ],
    },
    externals: {
      // fs, tls and net are needed so that airbrake-js can be compiled by webpack
      fs: "{}",
      tls: "{}",
      net: "{}",
    },
    resolve: {
      modules: [srcPath, nodePath, protoPath],
    },
    optimization: {
      minimize: false,
      splitChunks: {
        chunks: "initial",
      },
    },
    // See https://webpack.js.org/configuration/devtool/
    devtool: env.production ? "source-map" : "eval-source-map",
    plugins,
    devServer: {
      contentBase: `${__dirname}/public`,
      publicPath: "/assets/bundle/",
      port: env.PORT ? env.PORT : 9002,
      hot: false,
      inline: false,
      writeToDisk: true,
    },
  };
};
