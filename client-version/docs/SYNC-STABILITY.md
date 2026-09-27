# Background refresh stability

The field app previously watched every RelayService notification as a data-provider dependency. Starting and finishing the 20-second background synchronization each triggered dependency reloads. The loaded widget tree was replaced by loading cards, then recreated with its entrance animation: a visible flicker and potential scroll reset.

Resource providers now depend on the account ID, and listen separately for synchronization completion. Completion explicitly invalidates the provider, retaining its existing AsyncValue data during refresh. Starting synchronization and unrelated status notifications do not reload resources. An account change remains a dependency reload and hides the previous account's data.

The regression test uses delayed futures to verify stable visible content, refreshed results and removal of old data on account switch. It fails on the original implementation and passes on the fix. No polling interval, server behavior or colour design was changed.

Release backup: /opt/relay-client/backups/sync-fix-20260927T085139Z. Contains database, web, migration state and build 19 APK. Migration 005 (head), API health passed. This is a mobile-only update. Rollback restores previous.apk; no database restore is needed.


Verification: 9 widget tests passed, including the new delayed-sync/account-isolation regression; Flutter analysis clean; release build 20 succeeded. Normal build 20 installed successfully and launched to the loaded dashboard. The physical integration runner initially needed explicit VM port attachment, then lost its connection. A subsequent normal-release sampling attempt also lost USB; do not claim continuous phone monitoring passed. The phone was temporarily locked to portrait for the check; automatic rotation must be restored when it reconnects.

APK SHA256 (local and VPS matched): 61bdde1d706341dd130aae1bb8addd7001f92395ea57f993c13d93cfd2acea52. Published as relay-client-scope.apk build 20. Screenshot evidence and failed-run diagnostics remain outside Git under output/qa.
