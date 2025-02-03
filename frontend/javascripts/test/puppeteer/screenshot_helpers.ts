import { PNG } from "pngjs";
import fs from "node:fs";
import pixelmatch from "pixelmatch";

export function isPixelEquivalent(changedPixels: number, width: number, height: number) {
  // There may be a difference of 0.1 %
  const allowedThreshold = 0.1 / 100;
  const allowedChangedPixel = allowedThreshold * width * height;
  return changedPixels < allowedChangedPixel;
}

function openScreenshot(path: string, name: string): Promise<PNG | null> {
  return new Promise((resolve) => {
    fs.createReadStream(`${path}/${name}.png`)
      .on("error", (error) => {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'code' does not exist on type 'Error'.
        if (error.code === "ENOENT") {
          resolve(null);
        } else {
          throw error;
        }
      })
      .pipe(new PNG())
      .on("parsed", function () {
        resolve(this);
      });
  });
}

async function deleteScreenshotIfExists(path: string, name: string): Promise<void> {
  try {
    // Delete the file
    await new Promise<void>((resolve, reject) => {
      fs.unlink(`${path}/${name}.png`, (unlinkErr) => {
        if (unlinkErr) {
          return reject(unlinkErr);
        }
        resolve();
      });
    });
  } catch {}
}

function saveScreenshot(png: PNG, path: string, name: string): Promise<void> {
  return new Promise((resolve) => {
    png
      .pack()
      .pipe(fs.createWriteStream(`${path}/${name}.png`))
      .on("finish", () => resolve());
  });
}

export function bufferToPng(buffer: Buffer | string, width: number, height: number): Promise<PNG> {
  return new Promise((resolve) => {
    const png = new PNG({
      width,
      height,
    });
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

  if (width !== existingScreenshot.width || height !== existingScreenshot.height) {
    console.warn("Width/height differs between screenshots. Using Infinity as pixelErrors value.");
    await saveScreenshot(newScreenshot, path, `${name}.new`);
    return Number.POSITIVE_INFINITY;
  }

  const diff = new PNG({
    width,
    height,
  });
  const pixelErrors = pixelmatch(
    existingScreenshot.data,
    newScreenshot.data,
    diff.data,
    existingScreenshot.width,
    existingScreenshot.height,
    {
      // The default of the pixelmatch library is 0.1.
      // 0.01 was chosen since it was the smallest threshold
      // that could solve some flakiness.
      threshold: 0.01,
    },
  );

  if (!isPixelEquivalent(pixelErrors, width, height)) {
    // If the screenshots are not equal, save the diff and the new screenshot
    await Promise.all([
      saveScreenshot(diff, path, `${name}.diff`),
      saveScreenshot(newScreenshot, path, `${name}.new`),
    ]);
  } else {
    await Promise.all([
      deleteScreenshotIfExists(path, `${name}.diff`),
      deleteScreenshotIfExists(path, `${name}.new`),
    ]);
  }

  return pixelErrors;
}
export default {};
