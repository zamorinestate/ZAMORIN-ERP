# Zamorin ERP Target Repository Migration Manifest

## Purpose

Prepare the migration of the accepted Zamorin Café ERP application into
the target repository `zamorinestate/ZAMORIN-ERP` without losing the
accepted application history or prematurely publishing changes.

## Verified starting point

- Integration branch: `integration/zamorin-erp-target`
- Starting commit: `64ead80b9a41d631c0a36e9c37a51d6b06df96bb`
- Target branch inspected: `target/main`
- Target tip inspected: `433a2f15e51eefa6fdfb638615a507260aaef89a`
- Target and local histories have no common ancestor.
- A backup branch exists: `backup/pre-target-integration-64ead80`.

## Source-of-truth policy

The accepted local application branch is the source of truth for application
code, tests, architecture, documentation, and release evidence. Target-only
files must be evaluated individually. Do not merge the target history
wholesale into the application branch.

## Initial file decisions

| Path | Decision | Reason |
|---|---|---|
| `.github/workflows/docker-publish.yml` | Defer | Review build context, image publication, action pinning, and permissions before activation. |
| `settings.json` | Exclude | Contains machine-specific paths and disables several analysis features. |
| `Dockerfile` | Keep accepted local version | Local Node runtime aligns with the application's declared Node engine range. |
| `package.json` and `package-lock.json` | Keep accepted local versions | Validate scripts, package-manager compatibility, and path casing before release. |
| `docker-compose.yml` | Keep accepted local version | Target version contains fallback credentials and a default master password. |
| `render.yaml` and `vercel.json` | Keep accepted local versions | Do not substitute unverified target deployment configuration. |
| `.gitignore` and `.gitattributes` | Keep accepted local versions initially | Review target differences separately before any intentional adoption. |
| `AGENTS.md` | Exclude target version pending rewrite | Target instructions conflict with the accepted five-window architecture. |
| Application source, tests, scripts, docs, and release evidence | Preserve accepted local versions | These constitute the accepted application baseline. |

## Mandatory checks before any publication

1. Confirm the intended destination branch and migration strategy.
2. Review tracked files for secrets, credentials, and accidental local data.
3. Validate all package scripts against actual tracked paths, including case.
4. Validate Docker build context, startup command, runtime version, and dependencies.
5. Remove insecure credential defaults from any configuration proposed for deployment.
6. Run the applicable release regression and configuration checks.
7. Review the exact staged diff and outgoing commit list.
8. Obtain explicit approval before pushing or deleting any repository.

## Explicitly not authorized by this manifest

- No unrelated-history merge.
- No force-push or target branch overwrite.
- No deployment or production configuration change.
- No deletion of `estate-erp`.
- No activation of the deferred Docker publishing workflow.

## Status

Preparation only. The manifest must be reviewed and the migration plan
approved before creating an integration commit.
