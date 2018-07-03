const puppeteer = require("puppeteer");

process.on("unhandledRejection", (err, promise) => {
  console.error("###### Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

async function takeScreenshot() {
  const browser = await puppeteer.launch({
    args: ["--headless", "--hide-scrollbars"],
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1920, height: 1080 });
  await page.goto(
    "http://localhost:9000/annotations/Explorational/5b35fbcf8000003b01dd8b88#541,253,522,0,2.00,13",
    { waitUntil: "networkidle0", timeout: 0 },
  );
  await page.screenshot({ path: "example.png" });

  await browser.close();
}

module.exports = {
  takeScreenshot,
};

takeScreenshot();
