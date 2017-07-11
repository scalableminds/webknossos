module.exports = function (env = {}) {
  /* eslint no-var:0, import/no-extraneous-dependencies:0 */
  var webpack = require("webpack");
  var ExtractTextPlugin = require("extract-text-webpack-plugin");
  var fs = require("fs");
  var path = require("path");

  var srcPath = path.resolve(__dirname, "app/assets/javascripts/");
  var nodePath = path.join(__dirname, "node_modules/");
  var scriptPaths = {
    "jasny-bootstrap": `${nodePath}jasny-bootstrap/dist/js/jasny-bootstrap`,
    "bootstrap-multiselect": `${nodePath}bootstrap-multiselect/dist/js/bootstrap-multiselect`,
    "react-jsoneditor": `${nodePath}/react-jsoneditor/build/app.js`,
  };

  fs.writeFileSync(path.join(__dirname, "target", "webpack.pid"), process.pid, "utf8");

  return {
    entry: {
      main: "main.js",
    },
    output: {
      path: `${__dirname}/public/bundle`,
      filename: "[name].js",
      sourceMapFilename: "[file].map",
      publicPath: "/assets/bundle/",
      chunkFilename: env.production ? "[chunkhash].js" : "[name].js",
    },
    module: {
      // Reduce compilation time by telling webpack to not parse these libraries.
      // Only add libraries that have no dependencies eg. no require, define or similar calls.
      noParse: [
        /\/jquery\//,
      ],
      rules: [
        {
          test: /\.js$/,
          exclude: /(node_modules|bower_components)/,
          use: "babel-loader",
        },
        {
          test: /\.less$/,
          // This needs to be `loader` until `extract-text-webpack-plugin` is fixed
          // Ref: https://github.com/webpack/extract-text-webpack-plugin/issues/250
          use: ExtractTextPlugin.extract({
            fallback: "style-loader",
            use: "css-loader!less-loader",
          }),
        },
        {
          test: /\.css$/,
          // This needs to be `loader` until `extract-text-webpack-plugin` is fixed
          // Ref: https://github.com/webpack/extract-text-webpack-plugin/issues/250
          use: ExtractTextPlugin.extract({
            fallback: "style-loader",
            use: "css-loader!less-loader",
          }),
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
        }, {
          test: /\.(ttf|eot|svg)(\?v=[0-9]\.[0-9]\.[0-9])?$/,
          use: "file-loader",
        },
        { test: /\.png$/, use: { loader: "url-loader", options: { limit: 100000 } } },
        { test: /\.jpg$/, use: "file-loader" },
      ],
    },
    resolve: {
      modules: [
        srcPath,
        nodePath,
      ],
      alias: scriptPaths,
    },
    externals: [
      { routes: "var jsRoutes" },
    ],
    devtool: "cheap-module-source-map",
    plugins: [
      new webpack.DefinePlugin({
        'process.env.NODE_ENV': env.production ? '"production"' : '"development"',
      }),
      new ExtractTextPlugin("main.css"),
      new webpack.ProvidePlugin({
        $: "jquery",
        jQuery: "jquery",
        "window.jQuery": "jquery",
        _: "lodash",
      }),
      new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),
      new webpack.optimize.CommonsChunkPlugin({
          name: "vendor",
          minChunks: function (module) {
             // this assumes your vendor imports exist in the node_modules directory
             return module.context && module.context.indexOf("node_modules") !== -1;
          }
      }),
      //CommonChunksPlugin will now extract all the common modules from vendor and main bundles
      new webpack.optimize.CommonsChunkPlugin({
          name: "manifest" //But since there are no more common modules between them we end up with just the runtime code included in the manifest file
      }),
    ],
  };
}
