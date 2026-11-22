# SchoolMS database backup and recovery

This runbook describes the prototype's two recovery layers: Neon point-in-time recovery for recent mistakes, and a weekly encrypted logical backup with an isolated restore check.

## Configure the encrypted backup

The GitHub Actions workflow runs every Monday at 03:17 UTC and can also be started manually from **Actions → Database Backup and Restore Check → Run workflow**.

Before it can create a backup, add these repository secrets in **Settings → Secrets and variables → Actions**:

1. `SCHOOLMS_BACKUP_DATABASE_URL` — the direct, unpooled PostgreSQL connection string for the Neon production database, with SSL enabled. Do not paste this value into an issue, pull request, or chat.
2. `SCHOOLMS_BACKUP_ENCRYPTION_KEY` — a long, randomly generated passphrase from a password manager. Keep a separate copy in the school's approved password vault; without it, retained backup artifacts cannot be decrypted.

The workflow reads the live database and creates a compressed `pg_dump`. It restores that dump into a temporary PostgreSQL instance of the same major version, checks that the restored database has tables, encrypts the dump with AES-256, verifies the encrypted copy, and uploads only the encrypted file. The temporary database is removed when the run finishes. If either secret is missing, the run summary says that no backup was created.

GitHub keeps each encrypted artifact for 30 days. Treat workflow access as sensitive because repository collaborators who can run or change workflows may affect backup handling. This rolling artifact is a short-term, off-provider recovery copy, not a long-term archive. Before a school pilot with real records, choose an approved off-site retention destination and retention period with the school.

## Live readiness check

The backend exposes two unauthenticated, read-only health endpoints:

- `/health` confirms the Node process responds. It does not verify the database.
- `/ready` runs a small database query and returns HTTP 200 only when the database is reachable; otherwise it returns HTTP 503 without exposing connection details.

To have Render route traffic only to a database-ready backend, open **schoolms-backend-prototype → Settings → Health Checks**, choose **Edit**, set the path to `/ready`, and save. Render uses HTTP health checks to decide whether an instance is ready for traffic and can restart an unhealthy running instance; verify the service becomes healthy after saving. See [Render health checks](https://render.com/docs/health-checks).

## Recover from a recent data mistake with Neon

Neon's Free plan currently advertises a six-hour Instant Restore window, subject to its current plan limits and the project's actual settings. Verify the window in the Neon console before relying on it. See [Neon's current Free plan information](https://neon.com/blog/neon-free-plan-1-gb-per-project).

1. Pause writes to SchoolMS if possible and record when the problem began.
2. In Neon, open the production branch's **Restore** screen. Use time-travel assistance to inspect the database immediately before the unwanted change.
3. Confirm the selected timestamp and the effect on writes made since then. A point-in-time restore rewinds the branch and can remove later changes.
4. Only after confirming the recovery point, perform the restore. Check the resulting branch and database health before resuming use.

Neon describes point-in-time restore in its [restore guide](https://neon.com/blog/announcing-point-in-time-restore). For a dropped table or a small set of records, first recover to an isolated branch and copy only the needed data where possible; a full rewind may discard valid later work.

## Restore an encrypted GitHub artifact

Use this for recovery beyond the provider's restore window or if the provider account is unavailable. Download the encrypted artifact from the successful **Database Backup and Restore Check** workflow run. Decrypt it using the key held in the password vault, then restore it into a new, isolated PostgreSQL database of the same major version. The workflow's temporary restore check demonstrates that the archive can be opened and imported.

Do not restore an artifact directly over the live database as a first step. Validate the recovered records and schema in isolation, preserve the current database state, and plan any production cutover with the school's system owner.

## Recovery checklist

- Confirm a recent successful workflow run and encrypted artifact are available.
- Confirm the encryption key can be retrieved by an authorized backup custodian.
- Keep real student data out of screenshots, pull requests, and workflow logs.
- Before real-school use, perform and record a supervised restore drill and agree who can authorize a production recovery.
