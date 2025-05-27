import Toast from "./toast";

export default function checkBrowserFeatures() {
  try {
    // Test some features that WK uses and that are known
    // to not exist on older browsers.
    new AbortController();
    Object.fromEntries([]);
    new BigUint64Array(1);
    "hello".replaceAll("l", "k");
    new Map([[1, 2]]).values().map((v) => v);
    [].at(0);
  } catch (exception) {
    Toast.warning(
      <div>
        Your browser seems to be outdated.{" "}
        <a href="https://browser-update.org/update.html" target="_blank" rel="noreferrer">
          Update your browser
        </a>{" "}
        to avoid errors. See console for details.
      </div>,
    );
    console.error(
      "This browser lacks support for some modern features. Exception caught during test of features:",
      exception,
    );
  }
}
