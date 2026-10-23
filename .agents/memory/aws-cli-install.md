---
name: AWS CLI installation
description: Version-specific behavior of the current AWS CLI v2 Linux installer.
---

The current AWS CLI v2 Linux installer uses `XDG_DATA_HOME` and `XDG_BIN_HOME` for user-local paths and rejects the older `-i` install flag. Check the downloaded installer's `--help` before supplying options; its default user-local install does not require root.

**Why:** The install interface changed from common older examples, and a failed option can look like an installation failure even though no CLI change occurred.

**How to apply:** Prefer the installer's supported defaults or XDG variables, keep signature verification enabled, and verify `aws --version` plus shell PATH after installation.
