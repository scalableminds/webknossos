module.exports = function (env = {}) {
  /* eslint import/no-extraneous-dependencies:0, global-require:0, func-names:0 */
  const webpack = require("webpack");
  const path = require("path");
  const MiniCssExtractPlugin = require("mini-css-extract-plugin");
  const TerserPlugin = require("terser-webpack-plugin");
  const browserslistToEsbuild = require("browserslist-to-esbuild");
  const CopyPlugin = require("copy-webpack-plugin");

  const srcPath = path.resolve(__dirname, "frontend/javascripts/");
  const nodePath = "node_modules";
  const protoPath = path.join(__dirname, "webknossos-datastore/proto/");
  const publicPath = "/assets/bundle/";

  const plugins = [
    new webpack.DefinePlugin({
      "process.env.NODE_ENV": env.production ? '"production"' : '"development"',
      "process.env.BABEL_ENV": process.env.BABEL_ENV,
    }),
    new webpack.IgnorePlugin({ resourceRegExp: /^\.\/locale$/, contextRegExp: /moment$/ }),
    new webpack.ProvidePlugin({
      // Needed for saxophone, i.e. readable-stream, since it is used without importing
      // Corresponding issue: https://github.com/nodejs/readable-stream/issues/450
      process: "process/browser",
    }),
    new MiniCssExtractPlugin({
      filename: "[name].css",
      chunkFilename: "[name].css",
    }),
    new CopyPlugin({
      patterns: [
        // Use copy plugin to copy *.wasm to output folder.
        { from: "node_modules/onnxruntime-web/dist/*.wasm", to: "[name][ext]" },
        { from: "public/models/*.*", to: "models/[name][ext]" },
        // For CSP, see https://gildas-lormeau.github.io/zip.js/api/interfaces/Configuration.html#workerScripts
        { from: "node_modules/@zip.js/zip.js/dist/z-worker.js", to: "[name][ext]" },
      ],
    }),
  ];

  if (env.production) {
    plugins.push(
      new TerserPlugin({
        terserOptions: {
          // compress is bugged, see https://github.com/mishoo/UglifyJS2/issues/2842
          // even inline: 1 causes bugs, see https://github.com/scalableminds/webknossos/pull/2713
          // Update 20.01.2022: Doesn't seem to be bugged any longer, but the size gains (~5%) are not
          // worth the increased build time (~60%).
          compress: false,
        },
      }),
    );
  }

  const cssLoaderUrlFilter = {
    // Don't try to handle urls that already point to the assets directory
    filter: (url) => !url.startsWith("/assets/"),
  };

  return {
    experiments: { asyncWebAssembly: true },
    entry: {
      main: "main.tsx",
    },
    mode: env.production ? "production" : "development",
    output: {
      path: `${__dirname}/public/bundle`,
      filename: "[name].js",
      sourceMapFilename: "[file].map",
      publicPath,
    },
    module: {
      rules: [
        {
          test: /\.worker\.ts$/,
          use: [
            {
              loader: "worker-loader",
              options: {
                filename: "[name].[contenthash].worker.js",
              },
            },
          ],
        },
        {
          test: /\.tsx?$/,
          exclude: /(node_modules|bower_components)/,
          loader: "esbuild-loader",
          options: {
            loader: "tsx", // also supports 'ts'
            target: browserslistToEsbuild([
              "last 3 Chrome versions",
              "last 3 Firefox versions",
              "last 2 Edge versions",
              "last 1 Safari versions",
              "last 1 iOS versions",
            ]),
          },
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
      extensions: [".ts", ".tsx", ".js", ".json"],
      fallback: {
        // Needed for jsonschema
        url: require.resolve("url/"),
        // Needed for lz4-wasm-nodejs (which is only used in test context, which is
        // why we use empty modules)
        path: false,
        util: false,
        fs: false,
        // Needed for mock-require
        module: false,
      },
    },
    optimization: {
      minimize: env.production,
      splitChunks: {
        chunks: "all",
        // Use a consistent name for the vendors chunk
        name: "vendors~main",
        cacheGroups: {
          onnx: {
            test: /[\\/]node_modules[\\/](onnx.*)[\\/]/,
            chunks: "all",
            name: "vendors~onnx",
          },
          html2canvas: {
            test: /[\\/]node_modules[\\/](html2canvas)[\\/]/,
            chunks: "all",
            name: "vendors~html2canvas",
          },
        },
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
        publicPath,
      },
      port: env.PORT != null ? env.PORT : 9002,
      hot: false,
      liveReload: false,
      client: {
        overlay: false,
        logging: "error",
      },
    },
    cache: {
      type: "filesystem",
      buildDependencies: {
        config: [__filename],
      },
    },
    stats: {
      preset: "minimal",
    },
    // Ignore the lengthy warning considering STLExporter which is added to the exports dynamically
    ignoreWarnings: [/export 'STLExporter'/],
  };
};
