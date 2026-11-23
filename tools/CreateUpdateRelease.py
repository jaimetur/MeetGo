#!/usr/bin/env python3
"""Create a new MeetGo release or update the metadata of the current one.

Adapted from DriveTest Analyzer's and BodyLens' tool of the same name. A MeetGo release is:
  - a branch named after the version (X.Y.Z), committed and pushed to origin;
  - a `## Release: vX.Y.Z` block on top of CHANGELOG.md, whose header gives the current version and release date;
  - the same version in pyproject.toml, src/frontend/package.json and src/frontend/package-lock.json;
  - the major.minor of the Android app's versionName (android/app/build.gradle.kts; the patch is the CI build number).

Usage:
  python tools/CreateUpdateRelease.py                                 # window (Tk); questions in the terminal without Tk
  python tools/CreateUpdateRelease.py --update 0.1.0 2026-09-10       # rewrite the current release header and versions
  python tools/CreateUpdateRelease.py --create 0.2.0 2026-12-01       # new release branch, committed and pushed
          [--dirty commit|carry|discard]                              # what to do with uncommitted work (default: stop)
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from datetime import date
from enum import Enum
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHANGELOG_PATH = ROOT / 'CHANGELOG.md'
PYPROJECT_PATH = ROOT / 'pyproject.toml'
PACKAGE_JSON_PATH = ROOT / 'src' / 'frontend' / 'package.json'
PACKAGE_LOCK_PATH = ROOT / 'src' / 'frontend' / 'package-lock.json'
ANDROID_GRADLE_PATH = ROOT / 'android' / 'app' / 'build.gradle.kts'
# only X.Y.Z: release branches are named like that and pyproject.toml needs a valid Python version
VERSION_PATTERN = r'\d+\.\d+\.\d+'
DATE_PATTERN = r'\d{4}-\d{2}-\d{2}'

RELEASE_SECTIONS = (
    '#### ⚠️ Breaking Changes:',
    '#### 🌟 New Features:',
    '#### 🚀 Enhancements:',
    '#### 🐛 Bug fixes:',
    '#### 📚 Documentation:',
)


class DirtyTreeAction(Enum):
    """Available ways to handle uncommitted work before creating a branch."""

    COMMIT_AND_PUSH = 'commit_and_push'
    CARRY_TO_NEW_BRANCH = 'carry_to_new_branch'
    DISCARD = 'discard'
    CANCEL = 'cancel'


class GitCommandError(RuntimeError):
    """Raised when a Git command cannot be completed."""


def run_git(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    """Run Git in the project root and return its completed process."""
    result = subprocess.run(['git', *arguments], cwd=ROOT, capture_output=True, text=True, encoding='utf-8',
                            errors='replace', check=False)
    if check and result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or 'Unknown Git error.'
        raise GitCommandError(f"git {' '.join(arguments)} failed:\n{detail}")
    return result


# ---------- release metadata ----------

def read_release_metadata() -> tuple[str, str]:
    """Return the current version and release date from the first CHANGELOG.md release header."""
    content = CHANGELOG_PATH.read_text(encoding='utf-8')
    version_match = re.search(r'^## Release: v(\S+)\s*$', content, flags=re.MULTILINE)
    date_match = re.search(r'^### Release Date: (\d{4}-\d{2}-\d{2})\s*$', content, flags=re.MULTILINE)
    if not version_match or not date_match:
        raise RuntimeError('Unable to find the current release version and date in CHANGELOG.md.')
    return version_match.group(1), date_match.group(1)


def replace_pyproject_version(content: str, version: str) -> str:
    """Return pyproject content with the [project] version updated."""
    content, count = re.subn(r'^(version\s*=\s*")[^"]+("\s*)$', rf'\g<1>{version}\g<2>', content, count=1,
                             flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError('Unable to update the project version in pyproject.toml.')
    return content


def replace_package_json_version(content: str, version: str) -> str:
    """Return package.json content with its top-level version updated."""
    content, count = re.subn(r'^(  "version": ")[^"]+(")', rf'\g<1>{version}\g<2>', content, count=1,
                             flags=re.MULTILINE)
    if count != 1:
        raise RuntimeError('Unable to update the version in src/frontend/package.json.')
    return content


def replace_package_lock_version(content: str, version: str) -> str:
    """Return package-lock.json content with the version of the web package itself updated."""
    content, top_count = re.subn(r'^(  "version": ")[^"]+(")', rf'\g<1>{version}\g<2>', content, count=1,
                                 flags=re.MULTILINE)
    content, root_count = re.subn(r'("packages": \{\s*"": \{\s*"name": "[^"]*",\s*"version": ")[^"]+(")',
                                  rf'\g<1>{version}\g<2>', content, count=1)
    if top_count != 1 or root_count != 1:
        raise RuntimeError('Unable to update the version in src/frontend/package-lock.json.')
    return content


def replace_android_version(content: str, version: str) -> str:
    """Return the Gradle script with the major.minor of versionName updated (the patch is the CI build number)."""
    major, minor, _ = version.split('.')
    content, count = re.subn(r'(versionName\s*=\s*")\d+\.\d+\.(")', rf'\g<1>{major}.{minor}.\g<2>', content, count=1)
    if count != 1:
        raise RuntimeError('Unable to update versionName in android/app/build.gradle.kts.')
    return content


def replace_current_changelog_metadata(content: str, version: str, release_date: str) -> str:
    """Return changelog content with its current release header updated."""
    content, release_count = re.subn(r'^## Release: v[^\s]+\s*$', f'## Release: v{version}', content, count=1,
                                     flags=re.MULTILINE)
    content, date_count = re.subn(r'^### Release Date: \d{4}-\d{2}-\d{2}\s*$', f'### Release Date: {release_date}',
                                  content, count=1, flags=re.MULTILINE)
    if release_count != 1 or date_count != 1:
        raise RuntimeError('Unable to update the current release header in CHANGELOG.md.')
    return content


def add_changelog_release(content: str, version: str, release_date: str) -> str:
    """Insert a new empty release before the current changelog release."""
    if re.search(rf'^## Release: v{re.escape(version)}\s*$', content, flags=re.MULTILINE):
        raise RuntimeError(f'CHANGELOG.md already contains release v{version}.')
    first_release = re.search(r'^## Release: v[^\s]+\s*$', content, flags=re.MULTILINE)
    if not first_release:
        raise RuntimeError('Unable to find the current release in CHANGELOG.md.')
    release_block = (f'## Release: v{version}\n'
                     f'### Release Date: {release_date}\n'
                     + '\n\n'.join(RELEASE_SECTIONS) + '\n\n'
                     '---\n\n')
    return content[:first_release.start()] + release_block + content[first_release.start():]


def release_file_contents(version: str, release_date: str, *, create_changelog_release: bool) -> dict[Path, str]:
    """Build and validate every release file without changing the working tree."""
    changelog = CHANGELOG_PATH.read_text(encoding='utf-8')
    out = {
        CHANGELOG_PATH: (add_changelog_release(changelog, version, release_date) if create_changelog_release
                         else replace_current_changelog_metadata(changelog, version, release_date)),
        PYPROJECT_PATH: replace_pyproject_version(PYPROJECT_PATH.read_text(encoding='utf-8'), version),
        PACKAGE_JSON_PATH: replace_package_json_version(PACKAGE_JSON_PATH.read_text(encoding='utf-8'), version),
    }
    if PACKAGE_LOCK_PATH.exists():
        out[PACKAGE_LOCK_PATH] = replace_package_lock_version(PACKAGE_LOCK_PATH.read_text(encoding='utf-8'), version)
    if ANDROID_GRADLE_PATH.exists():
        out[ANDROID_GRADLE_PATH] = replace_android_version(ANDROID_GRADLE_PATH.read_text(encoding='utf-8'), version)
    return out


def write_release_files(version: str, release_date: str, *, create_changelog_release: bool) -> None:
    for path, content in release_file_contents(version, release_date,
                                               create_changelog_release=create_changelog_release).items():
        path.write_text(content, encoding='utf-8')


def update_release_metadata(version: str, release_date: str) -> None:
    """Update the versions and the current changelog release header (no new branch)."""
    write_release_files(version, release_date, create_changelog_release=False)


def validate_inputs(version: str, release_date: str) -> str | None:
    if not re.fullmatch(VERSION_PATTERN, version):
        return 'Version must use the X.Y.Z format.'
    if not re.fullmatch(DATE_PATTERN, release_date):
        return 'Release date must use YYYY-MM-DD format.'
    try:
        date.fromisoformat(release_date)
    except ValueError:
        return 'Release date is not a valid calendar date.'
    return None


# ---------- git ----------

def current_branch() -> str:
    """Return the checked-out branch, failing clearly for a detached HEAD."""
    result = run_git('symbolic-ref', '--quiet', '--short', 'HEAD', check=False)
    if result.returncode != 0 or not result.stdout.strip():
        raise GitCommandError('A named Git branch must be checked out before creating a release.')
    return result.stdout.strip()


def working_tree_changes() -> str:
    """Return porcelain status for tracked, staged and untracked files."""
    return run_git('status', '--porcelain=v1').stdout.rstrip()


def ensure_release_branch_is_available(branch: str) -> None:
    """Ensure a branch does not already exist locally or on origin."""
    local = run_git('show-ref', '--verify', '--quiet', f'refs/heads/{branch}', check=False)
    if local.returncode == 0:
        raise GitCommandError(f'Local branch {branch!r} already exists.')
    if local.returncode not in (0, 1):
        raise GitCommandError(f'Unable to check whether local branch {branch!r} exists.')
    run_git('remote', 'get-url', 'origin')
    remote = run_git('ls-remote', '--exit-code', '--heads', 'origin', branch, check=False)
    if remote.returncode == 0:
        raise GitCommandError(f'Remote branch origin/{branch} already exists.')
    if remote.returncode != 2:
        detail = remote.stderr.strip() or remote.stdout.strip() or 'Unknown Git error.'
        raise GitCommandError(f'Unable to check origin/{branch}:\n{detail}')


def prepare_working_tree(action: DirtyTreeAction, source_branch: str, version: str) -> None:
    """Apply the selected policy to pending work on the source branch."""
    if action is DirtyTreeAction.COMMIT_AND_PUSH:
        run_git('add', '--all')
        run_git('commit', '-m', f'Save work before creating release v{version}')
        run_git('push', 'origin', f'HEAD:refs/heads/{source_branch}')
    elif action is DirtyTreeAction.DISCARD:
        run_git('reset', '--hard', 'HEAD')
        run_git('clean', '-fd')
    elif action is DirtyTreeAction.CANCEL:
        raise RuntimeError('Release creation cancelled.')


def create_release(version: str, release_date: str, dirty_action: DirtyTreeAction) -> None:
    """Create, commit and publish a new release branch."""
    error = validate_inputs(version, release_date)
    if error:
        raise ValueError(error)
    source_branch = current_branch()
    run_git('check-ref-format', '--branch', version)
    ensure_release_branch_is_available(version)
    if working_tree_changes():
        prepare_working_tree(dirty_action, source_branch, version)
    release_file_contents(version, release_date, create_changelog_release=True)   # validate before branching
    run_git('switch', '--create', version)
    write_release_files(version, release_date, create_changelog_release=True)
    run_git('add', '--all')
    run_git('commit', '-m', f'Create release v{version}')
    run_git('push', '--set-upstream', 'origin', version)


# ---------- window ----------

def ask_dirty_tree_action(parent, changes: str) -> DirtyTreeAction:
    """Ask how pending work should be handled and return the selected action."""
    import tkinter as tk
    selection = DirtyTreeAction.CANCEL
    dialog = tk.Toplevel(parent)
    dialog.title('Uncommitted changes found')
    dialog.geometry('760x430')
    dialog.minsize(620, 360)
    dialog.transient(parent)
    dialog.grab_set()
    frame = tk.Frame(dialog, padx=18, pady=18)
    frame.pack(fill='both', expand=True)
    tk.Label(frame, text='Choose what to do with the current branch changes before creating the release:',
             anchor='w', justify='left').pack(fill='x', pady=(0, 10))
    status = tk.Text(frame, height=10, wrap='none')
    status.insert('1.0', changes)
    status.configure(state='disabled')
    status.pack(fill='both', expand=True, pady=(0, 14))
    tk.Label(frame, text='Discard permanently resets tracked files and removes untracked files.', anchor='w',
             fg='#9a3412').pack(fill='x', pady=(0, 10))

    def choose(action: DirtyTreeAction) -> None:
        nonlocal selection
        selection = action
        dialog.destroy()

    actions = tk.Frame(frame)
    actions.pack(fill='x')
    tk.Button(actions, text='Cancel', command=lambda: choose(DirtyTreeAction.CANCEL)).pack(side='right')
    tk.Button(actions, text='Discard Changes', command=lambda: choose(DirtyTreeAction.DISCARD)).pack(
        side='right', padx=(0, 8))
    tk.Button(actions, text='Carry to New Branch', command=lambda: choose(DirtyTreeAction.CARRY_TO_NEW_BRANCH)).pack(
        side='right', padx=(0, 8))
    tk.Button(actions, text='Commit and Push Current Branch',
              command=lambda: choose(DirtyTreeAction.COMMIT_AND_PUSH)).pack(side='right', padx=(0, 8))
    dialog.protocol('WM_DELETE_WINDOW', lambda: choose(DirtyTreeAction.CANCEL))
    parent.wait_window(dialog)
    return selection


def window() -> None:
    import tkinter as tk
    from tkinter import messagebox
    current_version, current_date = read_release_metadata()
    root = tk.Tk()
    root.title('Create or update MeetGo release')
    root.geometry('650x290')
    root.resizable(False, False)
    frame = tk.Frame(root, padx=18, pady=18)
    frame.pack(fill='both', expand=True)
    tk.Label(frame, text=f'Current version: {current_version}', anchor='w').pack(fill='x')
    tk.Label(frame, text=f'Current release date: {current_date}', anchor='w').pack(fill='x', pady=(0, 14))
    version_var = tk.StringVar(value=current_version)
    date_var = tk.StringVar(value=current_date)
    tk.Label(frame, text='New version (X.Y.Z):', anchor='w').pack(fill='x')
    tk.Entry(frame, textvariable=version_var).pack(fill='x', pady=(0, 10))
    tk.Label(frame, text='New release date (YYYY-MM-DD):', anchor='w').pack(fill='x')
    tk.Entry(frame, textvariable=date_var).pack(fill='x', pady=(0, 18))

    def input_values():
        version, release_date = version_var.get().strip(), date_var.get().strip()
        error = validate_inputs(version, release_date)
        if error:
            messagebox.showerror('Invalid release metadata', error, parent=root)
            return None
        return version, release_date

    def apply_update() -> None:
        values = input_values()
        if values is None:
            return
        try:
            update_release_metadata(*values)
        except Exception as exc:
            messagebox.showerror('Update failed', str(exc), parent=root)
            return
        messagebox.showinfo('Release metadata updated',
                            'CHANGELOG.md, pyproject.toml, src/frontend/package.json, src/frontend/package-lock.json and the '
                            'Android versionName were updated.', parent=root)
        root.destroy()

    def apply_create_release() -> None:
        values = input_values()
        if values is None:
            return
        try:
            changes = working_tree_changes()
        except Exception as exc:
            messagebox.showerror('Git check failed', str(exc), parent=root)
            return
        action = DirtyTreeAction.CARRY_TO_NEW_BRANCH
        if changes:
            action = ask_dirty_tree_action(root, changes)
            if action is DirtyTreeAction.CANCEL:
                return
        try:
            create_release(*values, action)
        except Exception as exc:
            messagebox.showerror('Release creation failed', str(exc), parent=root)
            return
        messagebox.showinfo('Release created',
                            f'Release v{values[0]} was committed and pushed to origin/{values[0]}.', parent=root)
        root.destroy()

    actions = tk.Frame(frame)
    actions.pack(fill='x')
    tk.Button(actions, text='Cancel', command=root.destroy).pack(side='right')
    tk.Button(actions, text='Update Current Release', command=apply_update).pack(side='right', padx=(0, 8))
    tk.Button(actions, text='Create New Release', command=apply_create_release).pack(side='right', padx=(0, 8))
    root.mainloop()


def terminal() -> int:
    """The same as the window, asked in the terminal (for a Python without Tk, e.g. Homebrew's without python-tk)."""
    current_version, current_date = read_release_metadata()
    print(f'Current version: {current_version}  ·  current release date: {current_date}')
    print('  1) Create New Release   2) Update Current Release   3) Cancel')
    choice = input('Choose [1/2/3]: ').strip()
    if choice not in ('1', '2'):
        print('Cancelled.')
        return 0
    version = input(f'New version (X.Y.Z) [{current_version}]: ').strip() or current_version
    release_date = input(f'New release date (YYYY-MM-DD) [{date.today().isoformat()}]: ').strip() or date.today().isoformat()
    error = validate_inputs(version, release_date)
    if error:
        print(error, file=sys.stderr)
        return 2
    try:
        if choice == '2':
            update_release_metadata(version, release_date)
            print(f'Current release is now v{version} ({release_date}).')
            return 0
        action = DirtyTreeAction.CARRY_TO_NEW_BRANCH
        changes = working_tree_changes()
        if changes:
            print('Uncommitted changes found:\n' + changes)
            print('  1) Commit and push them to the current branch   2) Carry them to the new branch   '
                  '3) Discard them (permanently)   4) Cancel')
            action = {'1': DirtyTreeAction.COMMIT_AND_PUSH, '2': DirtyTreeAction.CARRY_TO_NEW_BRANCH,
                      '3': DirtyTreeAction.DISCARD}.get(input('Choose [1/2/3/4]: ').strip(), DirtyTreeAction.CANCEL)
            if action is DirtyTreeAction.CANCEL:
                print('Cancelled.')
                return 0
        if input(f'Create branch {version}, commit and push it to GitHub? [y/N]: ').strip().lower() not in ('y', 'yes', 's', 'si', 'sí'):
            print('Cancelled.')
            return 0
        create_release(version, release_date, action)
        print(f'Release v{version} created and pushed to origin/{version}.')
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Create a new MeetGo release or update the current one. '
                                                 'Without arguments, opens a window.')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--update', nargs=2, metavar=('VERSION', 'DATE'), help='rewrite the current release header')
    group.add_argument('--create', nargs=2, metavar=('VERSION', 'DATE'), help='create, commit and push a release branch')
    parser.add_argument('--dirty', choices=('commit', 'carry', 'discard'),
                        help='with --create: commit and push, carry or discard uncommitted work (default: stop)')
    args = parser.parse_args(argv)
    if not args.update and not args.create:
        try:
            import tkinter  # noqa: F401
        except ImportError:
            print('(This Python has no Tk, so no window: answering in the terminal. For the window on macOS with '
                  'Homebrew: brew install python-tk@3.12)\n')
            return terminal()
        window()
        return 0
    version, release_date = args.update or args.create
    error = validate_inputs(version, release_date)
    if error:
        print(error, file=sys.stderr)
        return 2
    try:
        if args.update:
            update_release_metadata(version, release_date)
            print(f'Current release is now v{version} ({release_date}).')
        else:
            action = {'commit': DirtyTreeAction.COMMIT_AND_PUSH, 'carry': DirtyTreeAction.CARRY_TO_NEW_BRANCH,
                      'discard': DirtyTreeAction.DISCARD, None: DirtyTreeAction.CANCEL}[args.dirty]
            create_release(version, release_date, action)
            print(f'Release v{version} created and pushed to origin/{version}.')
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
