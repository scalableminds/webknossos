module.exports = function (env = {}) {
  /* eslint import/no-extraneous-dependencies:0, global-require:0, func-names:0 */
  const webpack = require("webpack");
  const { EsbuildPlugin } = require("esbuild-loader");
  const path = require("path");
  const MiniCssExtractPlugin = require("mini-css-extract-plugin");
  const browserslistToEsbuild = require("browserslist-to-esbuild");
  const CopyPlugin = require("copy-webpack-plugin");

  const srcPath = path.resolve(__dirname, "frontend/javascripts/");
  const nodePath = "node_modules";
  const protoPath = path.join(__dirname, "webknossos-datastore/proto/");
  const publicPath = "/assets/bundle/";

  const buildTarget = browserslistToEsbuild([
    "last 3 Chrome versions",
    "last 3 Firefox versions",
    "last 2 Edge versions",
    "last 1 Safari versions",
    "last 1 iOS versions",
  ]);

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
      chunkFilename: "[name].[contenthash].css",
    }),
    new CopyPlugin({
      patterns: [
        // For CSP, see https://gildas-lormeau.github.io/zip.js/api/interfaces/Configuration.html#workerScripts
        { from: "node_modules/@zip.js/zip.js/dist/z-worker.js", to: "[name][ext]" },
      ],
    }),
  ];

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
      sourceMapFilename: "[file].[contenthash].map",
      chunkFilename: "[name].[contenthash].js",
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
            target: buildTarget,
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
        {
          test: /\.m?js/,
          resolve: {
            fullySpecified: false,
          },
        },
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
      minimizer: [
        new EsbuildPlugin({
          target: buildTarget, // Syntax to transpile to (see options below for possible values)
        }),
      ],
      splitChunks: {
        chunks: "all",
        // Use a consistent name for the vendors chunk
        name: "vendors~main",
        cacheGroups: {
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
        logging: "none",
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
    // Ignore the lengthy warnings which are added to the exports dynamically
    ignoreWarnings: [
      /export 'STLExporter'/,
      /export 'SRGBColorSpace'/,
      /export 'LinearSRGBColorSpace'/,
    ],
  };
};
