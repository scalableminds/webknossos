import datetime
import re
import sys


def update_changelogs():

    # Read existing changelogs
    with open("CHANGELOG.unreleased.md") as f:
        unreleased_changelog_lines = list(s.rstrip() for s in f)

    with open("CHANGELOG.released.md") as f:
        released_changelog_lines = list(s.rstrip() for s in f)

    # Determine new version
    this_version = sys.argv[1]
    today = datetime.date.today()
    today_str = f"{today.strftime('%Y')}-{today.strftime('%m')}-{today.strftime('%d')}"

    # Determine last version
    matches = re.finditer(
        r"^## \[v?(.*)\].*$", "\n".join(released_changelog_lines), re.MULTILINE
    )
    first_match = next(matches)
    last_version = first_match[1]

    last_release_idx = next(
        i
        for i, line in enumerate(released_changelog_lines)
        if line.startswith(first_match[0])
    )

    # Stop the script if new version is already the latest
    if last_version == this_version:
        print(f"Version {this_version} is already up-to-date.")
        sys.exit(0)

    # Find line with "## Unreleased" heading
    unreleased_idx = next(
        i
        for i, line in enumerate(unreleased_changelog_lines)
        if line.startswith("## Unreleased")
    )

    # Clean up unreleased notes (i.e. remove empty sections)
    released_notes = "\n".join(unreleased_changelog_lines[(unreleased_idx + 2) :])

    release_section_fragments = re.split("\n### (.*)\n", released_notes, re.MULTILINE)
    release_notes_intro = release_section_fragments[0]
    release_sections = list(
        zip(release_section_fragments[1::2], release_section_fragments[2::2])
    )
    nonempty_release_sections = [
        (section, content)
        for section, content in release_sections
        if content.strip() not in ["", "-"]
    ]

    cleaned_release_notes = (
        "\n".join(
            [release_notes_intro]
            + [
                f"### {section}\n{content}"
                for section, content in nonempty_release_sections
            ]
        )
    ).split("\n")

    # Update released changelog
    new_released_changelog_lines = (
        released_changelog_lines[:last_release_idx]
        + [
            f"## [{this_version}](https://github.com/scalableminds/webknossos/releases/tag/{this_version}) - {today_str}",
            f"[Commits](https://github.com/scalableminds/webknossos/compare/{last_version}...{this_version})",
        ]
        + cleaned_release_notes
        + ["", ""]
        + released_changelog_lines[(last_release_idx):]
    )
    with open("CHANGELOG.released.md", "wt") as f:
        f.write("\n".join(new_released_changelog_lines))

    # Update unreleased changelog
    empty_unreleased_lines = [
        "## Unreleased",
        f"[Commits](https://github.com/scalableminds/webknossos/compare/{this_version}...HEAD)",
        "",
        "### Added",
        "",
        "### Changed",
        "",
        "### Fixed",
        "",
        "### Removed",
        "",
        "### Breaking Changes",
        "",
    ]
    unreleased_header = unreleased_changelog_lines[:unreleased_idx]
    new_unreleased_changelog_lines = unreleased_header + empty_unreleased_lines
    with open("CHANGELOG.unreleased.md", "wt") as f:
        f.write("\n".join(new_unreleased_changelog_lines))


def update_migration_guides():

    # Read existing changelogs
    with open("MIGRATIONS.unreleased.md") as f:
        unreleased_migrationlog_lines = list(s.rstrip() for s in f)

    with open("MIGRATIONS.released.md") as f:
        released_migrationlog_lines = list(s.rstrip() for s in f)

    # Determine new version
    this_version = sys.argv[1]
    today = datetime.date.today()
    today_str = f"{today.strftime('%Y')}-{today.strftime('%m')}-{today.strftime('%d')}"

    # Determine last version
    matches = re.finditer(
        r"^## \[v?(.*)\].*$", "\n".join(released_migrationlog_lines), re.MULTILINE
    )
    first_match = next(matches)
    last_version = first_match[1]

    last_release_idx = next(
        i
        for i, line in enumerate(released_migrationlog_lines)
        if line.startswith(first_match[0])
    )

    # Stop the script if new version is already the latest
    if last_version == this_version:
        print(f"Version {this_version} is already up-to-date.")
        sys.exit(0)

    # Find line with "## Unreleased" heading
    unreleased_idx = next(
        i
        for i, line in enumerate(unreleased_migrationlog_lines)
        if line.startswith("## Unreleased")
    )

    # Clean up unreleased notes (i.e. remove empty sections)
    released_notes = "\n".join(unreleased_migrationlog_lines[(unreleased_idx + 2) :])

    release_section_fragments = re.split("\n### (.*)\n", released_notes, re.MULTILINE)
    release_notes_intro = release_section_fragments[0]

    release_sections = list(
        zip(release_section_fragments[1::2], release_section_fragments[2::2])
    )
    nonempty_release_sections = [
        (section, content)
        for section, content in release_sections
        if content.strip() not in ["", "-"]
    ]

    cleaned_release_notes = (
        "\n".join(
            [release_notes_intro]
            + [
                f"### {section}\n{content}"
                for section, content in nonempty_release_sections
            ]
        )
    ).split("\n")

    # Update released migrationlog
    new_released_migrationlog_lines = (
        released_migrationlog_lines[:last_release_idx]
        + [
            f"## [{this_version}](https://github.com/scalableminds/webknossos/releases/tag/{this_version}) - {today_str}",
            f"[Commits](https://github.com/scalableminds/webknossos/compare/{last_version}...{this_version})",
        ]
        + cleaned_release_notes
        + ["", ""]
        + released_migrationlog_lines[(last_release_idx):]
    )
    with open("MIGRATIONS.released.md", "wt") as f:
        f.write("\n".join(new_released_migrationlog_lines))

    # Update unreleased migrationlog
    empty_unreleased_lines = [
        "## Unreleased",
        f"[Commits](https://github.com/scalableminds/webknossos/compare/{this_version}...HEAD)",
        "",
        "### Postgres Evolutions:",
        "",
    ]
    unreleased_header = unreleased_migrationlog_lines[:unreleased_idx]
    new_unreleased_migrationlog_lines = unreleased_header + empty_unreleased_lines
    with open("MIGRATIONS.unreleased.md", "wt") as f:
        f.write("\n".join(new_unreleased_migrationlog_lines))


if __name__ == "__main__":
    update_changelogs()
    update_migration_guides()
