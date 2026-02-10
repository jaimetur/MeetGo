# Changelog

All notable changes to this project will be documented in this file.

## Unreleased
- Added backend room join endpoint to align frontend with /rooms/join.
- Removed backend Docker debug log endpoint to avoid missing docker module on startup.
- Added docker log timestamps for backend and web services via compose commands.
- Added restart + log helper script for development.
- Added .po-based frontend translations and loader (one file per language).
- Moved language selection into a Settings section and added settings save action.
- Updated room interest loading to use backend interests and restored emoji labels.
- Improved debug panel log formatting with timestamp + service tags.
- Fixed assorted frontend text and separator display issues.
