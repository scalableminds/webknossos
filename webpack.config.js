module.exports = function(env = {}) {
  /* eslint no-var:0, import/no-extraneous-dependencies:0, global-require:0, func-names:0 */
  var webpack = require("webpack");
  var fs = require("fs");
  var path = require("path");
  const TerserPlugin = require("terser-webpack-plugin");
  const MiniCssExtractPlugin = require("mini-css-extract-plugin");

  const CopyWebpackPlugin = require("copy-webpack-plugin");

  var srcPath = path.resolve(__dirname, "frontend/javascripts/");
  var nodePath = "node_modules";
  var protoPath = path.join(__dirname, "webknossos-datastore/proto/");

  fs.writeFileSync(path.join(__dirname, "target", "webpack.pid"), String(process.pid), "utf8");

  const plugins = [
    new webpack.DefinePlugin({
      "process.env.NODE_ENV": env.production ? '"production"' : '"development"',
      "process.env.BABEL_ENV": process.env.BABEL_ENV,
    }),
    new webpack.IgnorePlugin({ resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/ }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
      chunkFilename: "[name].css",
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: "./public/tf-models/**",
          to: "tf-models/[name][ext]",
          globOptions: {
            dot: true,
          },
        },
      ],
    }),
  ];

  if (env.production) {
    plugins.push(
      new TerserPlugin({
        terserOptions: {
          // compress is bugged, see https://github.com/mishoo/UglifyJS2/issues/2842
          // even inline: 1 causes bugs, see https://github.com/scalableminds/webknossos/pull/2713
          compress: false,
        },
      }),
    );
  }

  const cssLoaderUrlFilter = {
    filter: (url, resourcePath) => {
      // resourcePath - path to css file

      // Don't handle `img.png` urls
      if (url.startsWith("/assets")) {
        return false;
      }

      return true;
    },
  };

  return {
    entry: {
      main: "main.js",
      light: "style_light.js",
      dark: "style_dark.js",
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
          test: /\.worker\.js$/,
          use: {
            loader: "worker-loader",
            options: {
              filename: "[name].[contenthash].worker.js",
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
            { loader: "css-loader", options: { url: cssLoaderUrlFilter } },
            {
              loader: "less-loader",
              options: {
                lessOptions: {
                  javascriptEnabled: true,
                  rewriteUrls: "local",
                },
              },
            },
          ],
        },
        {
          test: /\.css$/,
          use: [
            MiniCssExtractPlugin.loader,
            { loader: "css-loader", options: { url: cssLoaderUrlFilter } },
            {
              loader: "less-loader",
              options: {
                lessOptions: {
                  javascriptEnabled: true,
                  rewriteUrls: "local",
                },
              },
            },
          ],
        },
        {
          test: /\.woff(2)?(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          type: "asset",
          parser: { dataUrlCondition: { maxSize: 10000 } },
          // generator: { mimetype: "application/font-woff" },
        },
        {
          test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          type: "asset/resource",
        },
        {
          test: /\.png$/,
          type: "asset",
          parser: { dataUrlCondition: { maxSize: 10000 } },
        },
        { test: /\.jpg$/, type: "asset/resource" },
        { test: /\.proto$/, use: ["json-loader", "proto-loader6"] },
      ],
    },
    resolve: {
      modules: [srcPath, nodePath, protoPath],
      alias: {
        react: path.resolve("./node_modules/react"),
      },
      fallback: { url: require.resolve("url/") },
    },
    optimization: {
      minimize: false,
      splitChunks: {
        chunks: "all",
        // Use a consistent name for the vendors chunk
        name: "vendors~main",
      },
    },
    // See https://webpack.js.org/configuration/devtool/
    devtool: env.production ? "source-map" : "eval-source-map",
    plugins,
    devServer: {
      static: {
        directory: `${__dirname}/public`,
      },
      devMiddleware: {
        publicPath: "/assets/bundle/",
      },
      port: env.PORT != null ? env.PORT : 9002,
      hot: false,
      client: {
        overlay: {
          warnings: false,
          errors: true,
        },
      },
    },
  };
};
