const esbuild = require('esbuild');
const path = require('node:path');
const fs = require('node:fs');
const protobuf = require('protobufjs');


// Community plugins
const { lessLoader } = require('esbuild-plugin-less');
const copyPlugin = require('esbuild-plugin-copy').default;
const workerPlugin = require('@chialab/esbuild-plugin-worker').default;

// Custom plugin for .proto files (keeping this since it's very specific to your setup)
const protoPath = path.join(__dirname, 'webknossos-datastore/proto');
const protoPlugin = {
  name: 'proto',
  setup(build) {
    const protoRoot = path.resolve(__dirname, 'webknossos-datastore/proto');

    // Handle .proto import resolution
    build.onResolve({ filter: /\.proto$/ }, args => {
      // Try to resolve relative to protoRoot
      const fullPath = path.resolve(protoRoot, args.path);

      if (fs.existsSync(fullPath)) {
        return { path: fullPath };
      }

      // Optionally: also check relative to importer
      const relativePath = path.resolve(path.dirname(args.importer), args.path);
      if (fs.existsSync(relativePath)) {
        return { path: relativePath };
      }

      return {
        errors: [{ text: `Could not resolve .proto file: ${args.path}` }],
      };
    });

    // Handle .proto file loading
    build.onLoad({ filter: /\.proto$/ }, async (args) => {

      try {
        const root = new protobuf.Root();

        // Resolve imports from protoRoot
        root.resolvePath = (origin, target) => path.resolve(protoRoot, target);

        const loaded = await root.load(args.path);
        const json = loaded.toJSON();

        return {
          contents: `module.exports = ${JSON.stringify(json)};`,
          loader: 'js',
        };
      } catch (error) {
        return {
          errors: [{ text: error.message, location: { file: args.path } }],
        };
      }
    });
  },
};

// Define build function
async function build(env = {}) {
  const isProduction = env.production || process.env.NODE_ENV === 'production';
  const srcPath = path.resolve(__dirname, 'frontend/javascripts/');
  
  
  const target = [
    'chrome90',
    'firefox88',
    'edge90',
    'safari14',
    'ios14',
  ]

  const buildOptions = {
    entryPoints: {
      main: path.resolve(srcPath, 'main.tsx'),
      // proto: protoPath
    },
    bundle: true,
    outdir: 'public/bundle',
    format: 'esm',
    target: target,
    platform: 'browser',
    splitting: true,
    chunkNames: '[name].[hash]',
    assetNames: '[name].[hash]',
    sourcemap: isProduction ? 'external' : 'inline',
    minify: isProduction,
    define: {
      'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
      'process.env.BABEL_ENV': JSON.stringify(process.env.BABEL_ENV || 'development'),
      'process.browser': 'true',
    },
    inject: [path.resolve(__dirname, 'process_shim.js')], // We'll create this file
    loader: {
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.eot': 'file',
      '.svg': 'file',
      '.png': 'file',
      '.jpg': 'file',
    },
    resolveExtensions: ['.ts', '.tsx', '.js', '.json', ".proto"],
    alias: {
      react: path.resolve('./node_modules/react'),
      three: path.resolve(__dirname, 'node_modules/three/src/Three.js'),
      url: require.resolve("url/"),
    },
    plugins: [
      protoPlugin,
      lessLoader({
        javascriptEnabled: true,
        // Add any other Less options you need
      }),
      copyPlugin({
        patterns: [
          {
            from: 'node_modules/@zip.js/zip.js/dist/z-worker.js',
            to: 'public/bundle/z-worker.js',
          },
        ],
      }),
      workerPlugin({
        // This creates separate worker bundles with their own names
        // Workers will be output as separate .js files
        // The main bundle will get URLs to these worker files
        target: target,
        format: 'iife', // Workers need to be IIFE format
        minify: isProduction,
        // Configure worker build options
        buildOptions: {
          // Don't inject process-shim in workers, provide fallbacks instead
          inject: [],
          define: {
            'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
            'process.browser': 'true',
            'global': 'globalThis',
          },
          // Provide proper fallbacks for Node.js modules in workers
          alias: {
            process: 'process/browser',
            
          },
        }}),
    ],
    external: ["/assets/images/*", 'fs', 'path', 'util', 'module', "*.wasm" 
  ], // Add any external dependencies here if needed
    publicPath: '/assets/bundle/',
    metafile: true, // Generate metadata for analysis
    logOverride: {
      'direct-eval': 'silent',
    },
  };
  
  if (env.watch) {
    // Development server mode
    const ctx = await esbuild.context(buildOptions);
    
    const { host, port } = await ctx.serve({
      servedir: 'public/bundle',
      port: env.PORT || 9002,
      onRequest: (args) => {
        console.log(`[${args.method}] ${args.path} - status ${args.status}`);
      },
    });
    
    console.log(`Development server running at http://${host}:${port}`);
    
    // Watch for changes
    await ctx.watch();
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await ctx.dispose();
      process.exit(0);
    });
  } else {
    // Production build
    const result = await esbuild.build(buildOptions);
    
    if (result.metafile) {
      // Write metafile for bundle analysis
      await fs.promises.writeFile(
        'public/bundle/metafile.json',
        JSON.stringify(result.metafile, null, 2)
      );
    }
    
    console.log('Build completed successfully!');
  }
}

module.exports = { build };

// If called directly
if (require.main === module) {
  const args = process.argv.slice(2);
  const env = {};
  
  args.forEach(arg => {
    if (arg === '--production') env.production = true;
    if (arg === '--watch') env.watch = true;
    if (arg.startsWith('--port=')) env.PORT = Number.parseInt(arg.split('=')[1]);
  });
  
  build(env).catch(console.error);
}