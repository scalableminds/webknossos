// Release notes for the "What's new" modal. Each note is a markdown file in frontend/release_notes/
// named `YYYY-MM-DD-some-slug.md`. The date in the file name is the publication date. The file
// starts with a `# Title` heading, followed by the markdown body.
//
// Only the file names are part of the main bundle (to compute the unread count). The contents
// are loaded lazily when the "What's new" modal is opened.

export type ReleaseNote = {
  id: string;
  title: string;
  date: number;
  body: string;
};

type ReleaseNoteFile = {
  id: string;
  date: number;
  load: () => Promise<string>;
};

const FILE_NAME_REGEX = /^(\d{4}-\d{2}-\d{2})-[\w-]+\.md$/;
const TITLE_REGEX = /^# (.+)\r?\n/;

export function parseReleaseNoteDate(fileName: string): number {
  const match = fileName.match(FILE_NAME_REGEX);
  const date = match != null ? Date.parse(`${match[1]}T00:00:00Z`) : Number.NaN;
  // Some engines roll over non-existent days (e.g., 2026-02-30 becomes 2026-03-02).
  const isValidCalendarDate =
    match != null && !Number.isNaN(date) && new Date(date).toISOString().startsWith(match[1]);
  if (!isValidCalendarDate) {
    throw new Error(`Release note ${fileName} must be named YYYY-MM-DD-some-slug.md.`);
  }
  return date;
}

export function parseReleaseNote(id: string, date: number, source: string): ReleaseNote {
  const match = source.match(TITLE_REGEX);
  if (match == null) {
    throw new Error(`Release note ${id} must start with a "# Title" heading.`);
  }
  return {
    id,
    title: match[1].trim(),
    date,
    body: source.slice(match[0].length).trim(),
  };
}

const releaseNoteLoaders = import.meta.glob<string>("../../release_notes/*.md", {
  query: "?raw",
  import: "default",
});

// Sorted from newest to oldest.
export const RELEASE_NOTE_FILES: ReleaseNoteFile[] = Object.entries(releaseNoteLoaders)
  .map(([path, load]) => {
    const id = path.split("/").pop() ?? path;
    return { id, date: parseReleaseNoteDate(id), load };
  })
  .sort((a, b) => b.date - a.date || b.id.localeCompare(a.id));

export function getUnreadReleaseNotesCount(lastViewedTimestamp: number): number {
  return RELEASE_NOTE_FILES.filter((file) => file.date > lastViewedTimestamp).length;
}

let releaseNotesPromise: Promise<ReleaseNote[]> | null = null;

export function loadReleaseNotes(): Promise<ReleaseNote[]> {
  if (releaseNotesPromise == null) {
    releaseNotesPromise = Promise.all(
      RELEASE_NOTE_FILES.map(async (file) =>
        parseReleaseNote(file.id, file.date, await file.load()),
      ),
    ).catch((error) => {
      // Allow retrying, e.g., after a network error.
      releaseNotesPromise = null;
      throw error;
    });
  }
  return releaseNotesPromise;
}
