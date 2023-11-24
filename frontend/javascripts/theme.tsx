let metaElement = document.querySelector("meta[name='commit-hash']");
const commitHash = metaElement ? metaElement.getAttribute("content") : null;
metaElement = document.querySelector("meta[name='selected-theme']");
let initialTheme = metaElement ? metaElement.getAttribute("content") : null;
if (initialTheme === "auto") {
  initialTheme =
    window.matchMedia("(prefers-color-scheme: dark)").media !== "not all" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
}
document.documentElement.style.display = "none";
document.head.insertAdjacentHTML(
  "beforeend",
  "<link " +
    'id="primary-stylesheet" ' +
    'rel="stylesheet" ' +
    'type="text/css" ' +
    'media="screen" ' +
    'href="/assets/bundle/' +
    initialTheme +
    ".css?nocache=" +
    commitHash +
    '" ' +
    "/>",
);
document.getElementById("primary-stylesheet")?.addEventListener("load", () => {
  document.documentElement.style.display = "";
});
