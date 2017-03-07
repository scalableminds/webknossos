const fs = require("fs");
const path = require("path");

const filename = process.argv[2];

let counter = 0;

const newFileData = fs.readFileSync(filename, "utf-8").replace(/(import .*)"([\.\/]+.*)";/g, (match, rest, importPath) => {
  counter++;
  const newPath = path.relative("app/assets/javascripts", path.resolve(path.dirname(filename), importPath));
  return `${rest}"${newPath}";`;
});

if (counter > 0) {
  console.log(newFileData);
  fs.writeFileSync(filename, newFileData, "utf-8");
}
