module.exports = {
  excludes: ["./target/**", "./public/**"],
  useRelativePaths: false,
  environments: ["browser"],
  aliases: {
    _: "node_modules/lodash",
  },
  moduleNameFormatter({ moduleName, pathToCurrentFile }) {
    // trim the path prefix
    const appDirPrefix = "app/assets/javascripts/";
    if (moduleName.startsWith(appDirPrefix)) {
      return moduleName.slice(appDirPrefix.length);
    }
    return moduleName;
  },
};
