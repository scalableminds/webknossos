import {
  getUnreadReleaseNotesCount,
  loadReleaseNotes,
  parseReleaseNote,
  parseReleaseNoteDate,
  RELEASE_NOTE_FILES,
} from "libs/release_notes";
import { describe, expect, it } from "vitest";

describe("Release notes", () => {
  it("should parse the date from the file name", () => {
    expect(parseReleaseNoteDate("2026-08-06-changelog-webknossos.md")).toBe(
      Date.parse("2026-08-06T00:00:00Z"),
    );
    expect(() => parseReleaseNoteDate("changelog.md")).toThrow();
    expect(() => parseReleaseNoteDate("2026-13-45-invalid.md")).toThrow();
  });

  it("should parse frontmatter with quoted and unquoted values", () => {
    const note = parseReleaseNote(
      "note.md",
      42,
      [
        "---",
        'title: "Version 26.08: new features"',
        "featuredLink: https://webknossos.org",
        "---",
        "",
        "## Heading",
        "",
        "Body text.",
        "",
      ].join("\n"),
    );
    expect(note).toEqual({
      id: "note.md",
      title: "Version 26.08: new features",
      date: 42,
      featuredImage: null,
      featuredLink: "https://webknossos.org",
      featuredLinkText: null,
      body: "## Heading\n\nBody text.",
    });
  });

  it("should reject notes without frontmatter or title", () => {
    expect(() => parseReleaseNote("a.md", 0, "Just text")).toThrow();
    expect(() => parseReleaseNote("b.md", 0, "---\nfeaturedLink: x\n---\n")).toThrow();
  });

  it("should load all release notes sorted from newest to oldest", async () => {
    const releaseNotes = await loadReleaseNotes();
    expect(releaseNotes.length).toBeGreaterThan(0);
    expect(releaseNotes.map((note) => note.id)).toEqual(RELEASE_NOTE_FILES.map((file) => file.id));
    for (let i = 1; i < releaseNotes.length; i++) {
      expect(releaseNotes[i - 1].date).toBeGreaterThanOrEqual(releaseNotes[i].date);
    }
  });

  it("should count release notes published after the given timestamp", () => {
    expect(getUnreadReleaseNotesCount(0)).toBe(RELEASE_NOTE_FILES.length);
    expect(getUnreadReleaseNotesCount(RELEASE_NOTE_FILES[0].date)).toBe(0);
  });
});
