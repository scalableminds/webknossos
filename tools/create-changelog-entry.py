#!/usr/bin/env python3

import subprocess
import os

TEMPLATE = """### Added
- This is an example. You may delete a section if it would become empty.

### Changed
- This is an example. You may delete a section if it would become empty.

### Fixed
- This is an example. You may delete a section if it would become empty.

### Removed
- This is an example. You may delete a section if it would become empty.

### Breaking Changes
- This is an example. You may delete a section if it would become empty.

### Migration
- This is an example. You may delete a section if it would become empty.

### Postgres Evolutions
- This is an example. You may delete a section if it would become empty. Use something like this as the format for this entry: [131-more-indices-on-users.sql](conf/evolutions/131-more-indices-on-users.sql)
"""


def get_pr_number_from_gh():
    try:
        result = subprocess.run(
            ["gh", "pr", "view", "--json", "number", "--jq", ".number"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        print(
            "⚠️  GitHub CLI (`gh`) not found. You can install it from https://cli.github.com/"
        )
    except subprocess.CalledProcessError:
        print("⚠️  No pull request found for the current branch.")
    return None


def main():
    pr_number = get_pr_number_from_gh()
    if not pr_number:
        pr_number = input("Enter the pull request number: ").strip()

    if not pr_number.isdigit():
        print("❌ Invalid PR number. Please use digits only.")
        exit(1)

    output_dir = "unreleased_changes"
    os.makedirs(output_dir, exist_ok=True)

    file_path = os.path.join(output_dir, f"{pr_number}.md")
    if os.path.exists(file_path):
        print(f"❌ File '{file_path}' already exists.")
        exit(1)

    with open(file_path, "w") as f:
        f.write(TEMPLATE)

    print(f"✅ Created changelog entry: {file_path}")


if __name__ == "__main__":
    main()
