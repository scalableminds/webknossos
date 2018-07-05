/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
const pixelmatch = require("pixelmatch");
const { PNG } = require("pngjs");
const fs = require("fs");

function openScreenshot(path, name) {
  return new Promise(resolve => {
    fs
      .createReadStream(`${path}/${name}.png`)
      .on("error", error => {
        if (error.code === "ENOENT") {
          resolve(null);
        } else {
          throw error;
        }
      })
      .pipe(new PNG())
      .on("parsed", function() {
        resolve(this);
      });
  });
}

function saveScreenshot(png, path, name) {
  return new Promise(resolve => {
    png
      .pack()
      .pipe(fs.createWriteStream(`${path}/${name}.png`))
      .on("finish", () => resolve());
  });
}

function bufferToPng(buffer, width, height) {
  return new Promise(resolve => {
    const png = new PNG({ width, height });
    png.parse(buffer, () => resolve(png));
  });
}

async function compareScreenshot(screenshotBuffer, width, height, path, name) {
  const newScreenshot = await bufferToPng(screenshotBuffer, width, height);
  const existingScreenshot = await openScreenshot(path, name);
  if (existingScreenshot == null) {
    // If there is no existing screenshot, save the current one
    await saveScreenshot(newScreenshot, path, name);
    return 0;
  }

  const diff = new PNG({ width, height });
  const pixelErrors = pixelmatch(
    existingScreenshot.data,
    newScreenshot.data,
    diff.data,
    existingScreenshot.width,
    existingScreenshot.height,
    { threshold: 0.0 },
  );

  if (pixelErrors > 0) {
    // If the screenshots are not equal, save the diff and the new screenshot
    await saveScreenshot(diff, path, `${name}.diff`);
    await saveScreenshot(newScreenshot, path, `${name}.new`);
  }
  return pixelErrors;
}

module.exports = {
  compareScreenshot,
};
