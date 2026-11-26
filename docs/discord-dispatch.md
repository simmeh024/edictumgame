# Discord development dispatches

The optional `discordDispatch` Firestore function announces a post when a `devnews/{id}` document first becomes published. It sends the full text and poll options as plain text in order, split across Discord messages, with a link to the post. Images, interactive poll voting, and rich formatting stay on the game page. It does not backfill old posts or mirror later edits. A withdrawn and republished post is announced at most once per document ID.

The function is disabled unless `EDICTUM_DISCORD_ENABLED=true` is present at deploy time. It does not alter other Firebase projects. Its bot needs View Channel and Send Messages in the target channel; no privileged Gateway intents are needed. Use a dedicated test server and Firebase project first.

## Setup, per project

1. Install Edictum Herald as a server bot. Enable Discord Developer Mode, right-click the target channel and copy its channel ID. Channel IDs are not tokens.
2. In `functions/.env.<firebase-project-id>`, preserve existing settings and add:

   ```text
   EDICTUM_DISCORD_ENABLED=true
   EDICTUM_DISCORD_CHANNEL_ID=<channel ID>
   ```

   The project-specific `.env` file is ignored by Git. Use the test project's ID and test channel first. Do not put the token in this file or source control.
3. With the Firebase CLI authenticated to the correct project, run `firebase functions:secrets:set DISCORD_BOT_TOKEN --project <project-id>` and enter the Discord bot token at the CLI prompt. Do not put the token in a command argument or chat. The deployment identity needs the appropriate Secret Manager and Firebase permissions.
4. Before deploying, set the GitHub Actions repository variable `DISCORD_DISPATCH_CHANNEL_ID` for production or `DISCORD_DISPATCH_STAGING_CHANNEL_ID` for staging. Use different channels and bots for each project. The normal workflows deploy all functions with `--force`; if the corresponding variable is absent, a later workflow run will remove the function. Set the Firebase secret before enabling the variable or the workflow's functions deploy can fail. The variable contains only the channel ID, never the token.
5. Deploy only this function with `firebase deploy --only functions:discordDispatch --project <project-id>`. Cloud Functions, Firestore event triggers, Eventarc and Secret Manager must be available in that project. Review the CLI's proposed changes before completing deployment.
6. Publish a new test dispatch in the test project and verify every part, the link, and that no mentions are generated. Test with a long dispatch and a poll. Then repeat the configuration and targeted deployment for production.

Firestore event delivery can be duplicated or delayed. `discordDispatch/{postId}` is a server-only delivery receipt containing the frozen messages, progress and a short lease; clients have no access under the default-deny rules. Failed events retry for the platform's retry window. Discord's deterministic nonce suppresses duplicate parts only for a short period. A crash or lost response after Discord accepts a message but before Firestore records it can still produce a duplicate on a late retry; inspect the channel and logs before manually replaying. A permanently failed event or a partially delivered post that is withdrawn and republished needs manual review. Monitor function errors; the function does not provide a separate dead-letter queue or alert.

To disable it, remove the opt-in and deliberately delete the deployed function using the Firebase CLI after checking its prompt. Do not remove its receipt documents unless you intend to permit reposting.
