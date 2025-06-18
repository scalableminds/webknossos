import datetime
import os
import re
import sys
import subprocess

VERSION_REGEX = r"[\d]{1,2}\.[\d]{1,2}.[\d]{0,2}"
GITHUB_REPO = "scalableminds/webknossos"
UNRELEASED_CHANGES_DIR = "unreleased_changes"


def get_current_version():
    if len(sys.argv) < 2:
        sys.exit("Usage: python make-changelog.py <version>, e.g. 22.03.1")
    this_version = sys.argv[1]
    if not re.match(VERSION_REGEX, this_version):
        raise ValueError("The version string should be specified like this: 22.03.1")
    return this_version


def get_today_str():
    today = datetime.date.today()
    return f"{today:%Y-%m-%d}"


def get_last_version_and_index(lines):
    matches = re.finditer(r"^## \[v?(.*)\].*$", "\n".join(lines), re.MULTILINE)
    first_match = next(matches)
    last_version = first_match[1]
    last_release_idx = next(
        i for i, line in enumerate(lines) if line.startswith(first_match[0])
    )
    return last_version, last_release_idx


def parse_change_files():
    changelog_sections = {
        "Added": [],
        "Changed": [],
        "Fixed": [],
        "Removed": [],
        "Breaking Changes": [],
    }
    migration_sections = {
        "Migration": [],
        "Postgres Evolutions": [],
    }

    for file_name in sorted(os.listdir(UNRELEASED_CHANGES_DIR)):
        if not file_name.endswith(".md"):
            continue
        pr_number = file_name.rsplit(".", 1)[0]
        try:
            pr_number = int(pr_number)
        except ValueError:
            print(f"Warning: Cannot parse pr number for {file_name}. Ignoring file.")
        with open(os.path.join(UNRELEASED_CHANGES_DIR, file_name)) as f:
            content = f.read()

        fragments = re.split(r"\n### (.+?)\n", "\n" + content, flags=re.MULTILINE)
        section_map = dict(zip(fragments[1::2], fragments[2::2]))

        added_lines = 0

        for section, body in section_map.items():
            if section in changelog_sections:
                for line in body.strip().splitlines():
                    if line.strip().startswith("- "):
                        changelog_sections[section].append(
                            f"{line.strip()} [#{pr_number}](https://github.com/{GITHUB_REPO}/pull/{pr_number})"
                        )
                        added_lines += 1
                    else:
                        print(
                            f"Warning: {file_name} contains lines that don't begin with a dash."
                        )
            elif section in migration_sections:
                for line in body.strip().splitlines():
                    if line.strip().startswith("- "):
                        migration_sections[section].append(line.strip())
                        added_lines += 1

        if added_lines == 0:
            print(
                f"Warning: {file_name} did not contain any changes that could be parsed."
            )

    return changelog_sections, migration_sections


def render_sections(sections_dict):
    output = []
    for section, entries in sections_dict.items():
        if entries:
            if section != "Migration":
                output.append(f"### {section}")
            output.extend(entries)
            output.append("")
        else:
            if section == "Postgres Evolutions":
                output.append(f"### {section}")
                output.append("None.")
                output.append("")
    return output


def update_released_file(
    file_path, version, last_version, last_idx, today_str, new_lines
):
    with open(file_path) as f:
        lines = [l.rstrip() for l in f]

    new_content = (
        lines[:last_idx]
        + [
            f"## [{version}](https://github.com/{GITHUB_REPO}/releases/tag/{version}) - {today_str}",
            f"[Commits](https://github.com/{GITHUB_REPO}/compare/{last_version}...{version})",
            "",
        ]
        + new_lines
        + lines[last_idx:]
    )

    with open(file_path, "wt") as f:
        f.write("\n".join(new_content))


def update_changelogs(version, today_str, changelog_sections):
    with open("CHANGELOG.released.md") as f:
        released_lines = [l.rstrip() for l in f]

    last_version, last_idx = get_last_version_and_index(released_lines)
    if last_version == version:
        print(f"Version {version} is already up-to-date.")
        sys.exit(0)

    changelog_content = render_sections(changelog_sections)
    update_released_file(
        "CHANGELOG.released.md",
        version,
        last_version,
        last_idx,
        today_str,
        changelog_content,
    )


def update_migration_guides(version, today_str, migration_sections):
    with open("MIGRATIONS.released.md") as f:
        released_lines = [l.rstrip() for l in f]

    last_version, last_idx = get_last_version_and_index(released_lines)
    if last_version == version:
        print(f"Version {version} is already up-to-date.")
        sys.exit(0)

    migration_content = render_sections(migration_sections)
    update_released_file(
        "MIGRATIONS.released.md",
        version,
        last_version,
        last_idx,
        today_str,
        migration_content,
    )


def git_rm_unreleased_files():
    for file in os.listdir(UNRELEASED_CHANGES_DIR):
        if file.endswith(".md"):
            path = os.path.join(UNRELEASED_CHANGES_DIR, file)
            try:
                subprocess.run(["git", "rm", path], check=True)
            except:
                print(f"Warning: Could not git rm {path}. Was it added to git?")


if __name__ == "__main__":
    print("Preparing release...")
    version = get_current_version()
    today_str = get_today_str()

    changelog_sections, migration_sections = parse_change_files()

    print("Updating changelog files...")
    update_changelogs(version, today_str, changelog_sections)

    print("Updating migration guides...")
    update_migration_guides(version, today_str, migration_sections)

    print("Removing unreleased change files...")
    git_rm_unreleased_files()

    print("Done.\n")
    print(
        "#### Please consider adding a Highlights-section to CHANGELOG.released.md and move noteworthy entries there. ####"
    )
