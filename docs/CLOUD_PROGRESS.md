# Florine Personal: accounts and progress

This fork adds Supabase email/password authentication and account-scoped study history. The course content, audio, and original attribution are retained.

## Deployment

- GitHub: Okpala76/florine-personal
- Supabase project: Florine (`yqxbjxlvobmkhqwdmbuz`, eu-west-1)
- Vercel project: florine-personal
- Required build variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- Use a Supabase publishable key. Never put a secret/service-role key in a Vite variable.
- Supabase Dashboard → Authentication → URL Configuration: set Site URL to the production origin and add that same origin to Redirect URLs. Add only trusted preview origins when testing email flows.
- Email confirmation remains enabled. Supabase's default email provider restricts delivery and volume; configure custom SMTP before opening registration to other people.
- No Gemini key is required for lessons, saved audio, or synchronization. AI feedback remains optional upstream functionality.

## How saving works

Every progress-changing action gets a unique ID and timestamp. It is saved to the device before the screen updates, then appended to `public.progress_events`. The table grants authenticated users SELECT/INSERT on their own rows only. UPDATE and DELETE are denied to client roles. The `(user_id,id)` primary key makes repeated uploads idempotent.

Phone and computer histories are combined by event ID and replayed deterministically. Completed units preserve the best score; XP, minutes, and exam attempts count each activity once. Vocabulary removals are events, so stale devices do not resurrect removed cards. Review scheduling uses the activity date, not the later upload date.

The UI pulls changes on focus, network reconnection and every 20 seconds while open. It displays pending saves and errors and offers Sync now, Export backup, and Restore backup. A backup is a versioned JSON event history; restoring merges event IDs without double-counting.

Offline activity is supported in an already-loaded app with a persisted session. This is not full offline course installation: reopening the site and loading uncached lessons/audio still needs internet. First sign-in requires internet.

Local events are separated by Supabase project and user ID. Sign-out clears visible in-memory progress but retains pending events under the old account's namespace, so another account never imports them. Signing back in retries pending uploads. Private browsing, deletion of site data, or storage eviction can still remove unsynced work. An account protects work only after cloud upload succeeds. Browser storage limits produce an explicit error rather than silently discarding saved history; export a backup if storage fills.

## Updates and compatibility

Do not change local key namespaces or delete/recreate the event table during app deployments. Event schema version 1 is validated on read. Unsupported/corrupt history produces an error; it is not overwritten with empty progress. Future operation/schema changes require compatibility code and regression tests before release. Existing original-app LocalStorage data is not automatically assigned to a signed-in user.

Reset/import operations are explicit replacements in the activity timeline. They are available through the original store API, not automatic update behavior. Event timestamps use device clocks; keep devices' automatic date/time enabled. An intentionally restored snapshot can replace prior state, whereas restoring this fork's event backup merges activity.

The original in-progress exam session and cosmetic frog state remain device-local; completed exam results are synchronized.

## Verification

`npm test` checks concurrent device progress, best scores, retry deduplication, vocabulary removal, historical review dates, streaks, reloads, account isolation, multi-tab writes, corrupt data protection and backup replay. `npm run lint` and `npm run build` check the app. Live database tests run inside a rolled-back transaction and verify own inserts, retry conflicts, cross-user read/write isolation, and denied history updates. Security advisors should remain clear.

The migration in `supabase/migrations` is already applied to this dedicated project. Apply schema migrations once through the migration process; do not run them on each frontend build. Database backups and any point-in-time recovery depend on the Supabase plan and are separate from application JSON exports.
