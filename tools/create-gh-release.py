import re
import subprocess
import sys
import tempfile

VERSION_REGEX = r"[\d]{1,2}\.[\d]{1,2}.[\d]{0,2}"


def extract_newest_changelog():

    with open("CHANGELOG.released.md") as f:
        released_changelog_lines = list(s.rstrip() for s in f)

    # Find section starts
    section_matches = re.finditer(
        r"^## \[v?(.*)\].*$", "\n".join(released_changelog_lines), re.MULTILINE
    )

    first_match = next(section_matches)
    newest_release_idx = next(
        i
        for i, line in enumerate(released_changelog_lines)
        if line.startswith(first_match[0])
    )

    second_match = next(section_matches)
    second_newest_release_idx = next(
        i
        for i, line in enumerate(released_changelog_lines)
        if line.startswith(second_match[0])
    )

    newest_version = next(
        re.finditer(
            VERSION_REGEX, released_changelog_lines[newest_release_idx], re.MULTILINE
        )
    )[0]

    # Skip the headline which is superfluous since the GH release will
    # have its own title
    released_notes_without_header = "\n".join(
        released_changelog_lines[newest_release_idx + 1 : second_newest_release_idx]
    )

    # Extract date from release headline
    full_release_line = released_changelog_lines[newest_release_idx]
    release_date = "-".join(full_release_line.split("-")[-3:]).strip()

    newest_version_anchor = newest_version.replace(".", "")

    release_header = f"""
* [Docker Image](https://hub.docker.com/r/scalableminds/webknossos) `scalableminds/webknossos:{newest_version}` :whale:
* [Changelog](CHANGELOG.released.md#{newest_version_anchor}---{release_date})
""".strip()

    # The first line of the released notes contain a link to the commit diff.
    # Prefix that with a * to be consistent with the new release header.
    release_body = release_header + "\n* " + released_notes_without_header.strip()

    return newest_version, release_body


if __name__ == "__main__":
    newest_version, release_body = extract_newest_changelog()

    current_sha = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip()

    # Check whether the tag already exists locally
    existing_tag_sha = subprocess.run(
        ["git", "rev-parse", f"refs/tags/{newest_version}"],
        capture_output=True,
        text=True,
    )
    if existing_tag_sha.returncode == 0:
        tag_sha = existing_tag_sha.stdout.strip()
        # Dereference in case it's an annotated tag object
        deref = subprocess.run(
            ["git", "rev-parse", f"refs/tags/{newest_version}^{{}}"],
            capture_output=True,
            text=True,
        )
        if deref.returncode == 0:
            tag_sha = deref.stdout.strip()
        if tag_sha != current_sha:
            print(
                f"ERROR: Tag {newest_version} already exists but points to {tag_sha}, "
                f"not the current HEAD {current_sha}. Aborting."
            )
            sys.exit(1)
        print(f"Tag {newest_version} already exists and matches HEAD.")
    else:
        print(f"Creating tag {newest_version} at {current_sha}...")
        subprocess.run(["git", "tag", newest_version], check=True)

    print(f"Pushing tag {newest_version} to remote...")
    subprocess.run(["git", "push", "origin", newest_version], check=True)

    with tempfile.NamedTemporaryFile("w") as tmp_file:
        tmp_file.write(release_body)
        tmp_file.flush()

        print("Create GitHub release with the CLI tool gh...")

        subprocess.run(
            [
                "gh",
                "release",
                "create",
                newest_version,
                "--notes-file",
                tmp_file.name,
                "--title",
                newest_version,
            ],
            check=True,
        )

        print("Done!")
