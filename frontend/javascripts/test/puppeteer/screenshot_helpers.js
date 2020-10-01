// @flow
import { PNG } from "pngjs";
import fs from "fs";
import pixelmatch from "pixelmatch";

function openScreenshot(path: string, name: string): Promise<typeof PNG> {
  return new Promise(resolve => {
    fs.createReadStream(`${path}/${name}.png`)
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

function saveScreenshot(png: typeof PNG, path: string, name: string): Promise<void> {
  return new Promise(resolve => {
    png
      .pack()
      .pipe(fs.createWriteStream(`${path}/${name}.png`))
      .on("finish", () => resolve());
  });
}

function bufferToPng(buffer: Buffer, width: number, height: number): Promise<typeof PNG> {
  return new Promise(resolve => {
    const png = new PNG({ width, height });
    png.parse(buffer, () => resolve(png));
  });
}

export async function compareScreenshot(
  screenshotBuffer: Buffer,
  width: number,
  height: number,
  path: string,
  name: string,
): Promise<number> {
  const [newScreenshot, existingScreenshot] = await Promise.all([
    bufferToPng(screenshotBuffer, width, height),
    openScreenshot(path, name),
  ]);
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
    await Promise.all([
      saveScreenshot(diff, path, `${name}.diff`),
      saveScreenshot(newScreenshot, path, `${name}.new`),
    ]);
  }
  return pixelErrors;
}

export default {};
