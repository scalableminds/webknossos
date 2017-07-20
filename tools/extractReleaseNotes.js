// Parse PR descriptions for release notes
const fetch = require("node-fetch");
const fs = require("fs");

// Set this path to the cached json file to avoid hitting the github api limit while developing
const CACHED_RESPONSE_PATH = "";
// Adjust this variable to the last PR that shouldn't be included in the release notes
const LAST_PR = 0;

const RELEASE_NOTES_REGEX = /### Mailable description[^:]*:\r\n([^#]*)/;

(async () => {
  let parsedJSON;
  // Either read from a file or hit the Github API
  if (CACHED_RESPONSE_PATH && CACHED_RESPONSE_PATH.length > 0) {
    parsedJSON = require(CACHED_RESPONSE_PATH);
  } else {
    // This fetches at most the last 100 closed PRs to avoid additional complexity, which should be enough
    const res = await fetch("https://api.github.com/repos/scalableminds/webknossos/pulls?state=closed&per_page=100");
    parsedJSON = await res.json();
    if (parsedJSON.message) {
      console.log(`Error while fetching from the Github API: ${parsedJSON.message}`);
      process.exit();
    }
  }

  const releaseNotes = parsedJSON
    // Filter PRs that were merged into master, were merged after LAST_PR and have a PR description
    .filter(pr => pr.base.ref === "master" && pr.number > LAST_PR && pr.body.length > 0)
    // Extract the Mailable description
    .map(pr => {
      const possibleMatch = pr.body.match(RELEASE_NOTES_REGEX);
      const match = (possibleMatch != null) ? possibleMatch[1].trim() : "";
      return { description: match, url: pr.html_url };
    })
    // Remove PRs that have no such description
    .filter(({ description }) => description.length > 0)
    // Concat all descriptions and their respective PR URL into a single multi-line string
    .reduce((result, pr) => `${result}${pr.description}\n(${pr.url})\n\n`, "");

  // Write the release notes to a file
  fs.writeFile("./release_notes.txt", releaseNotes, (err) => {
    if(err) {
      console.log(`Error while saving the release notes: ${err}`);
    }
    console.log("Release notes were saved to release_notes.txt");
  });
})();
