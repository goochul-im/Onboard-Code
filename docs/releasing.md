# Desktop release and updates

The desktop app is built natively on GitHub-hosted macOS and Windows runners. Docker is not used for native bundles because MSI and macOS application bundles depend on their target operating systems.

## One-time signing setup

Tauri updates must be signed. Keep the private key outside the repository and never commit it.

1. Generate an updater key locally with `npm run tauri signer generate`.
2. Put the generated public key in `apps/desktop/src-tauri/tauri.conf.json` under `plugins.updater.pubkey`.
3. In GitHub, open **Settings → Secrets and variables → Actions** and add:
   - `TAURI_SIGNING_PRIVATE_KEY`: the complete contents of the private key file.
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the private key password.
4. Keep a recoverable encrypted backup of both values. Losing either prevents existing installations from trusting future updates.

The local macOS key is stored outside the repository at `~/.tauri/onboard-code.key`. Its password is stored in Keychain under the service `onboard-code-tauri-updater`.

Copy each secret without printing it in the terminal:

```sh
pbcopy < ~/.tauri/onboard-code.key
security find-generic-password -a goochul -s onboard-code-tauri-updater -w | pbcopy
```

Run the first command immediately before saving `TAURI_SIGNING_PRIVATE_KEY`, then run the second immediately before saving `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Publish a release

1. Update the same semantic version in:
   - `apps/desktop/package.json`
   - `apps/desktop/src-tauri/Cargo.toml`
   - `apps/desktop/src-tauri/tauri.conf.json`
2. Run:

   ```sh
   cd apps/desktop
   npm run release:check
   npm run check
   ```

3. Push the release commit.
4. In GitHub Actions, run **Release desktop app**.

The workflow builds a universal macOS bundle and a Windows x64 installer, signs updater artifacts, creates `app-v{version}`, publishes the GitHub Release, and uploads `latest.json` for installed apps.

## Installed app behavior

The app checks the GitHub Release endpoint at startup. Source code, repository paths, notes, and analysis results are not included in the update request. When a newer signed version exists, an update button appears in the top bar. The user chooses when to download and install it.

## CI verification

`.github/workflows/verify.yml` continues to build debug native bundles on both operating systems. Updater artifacts are disabled only for this verification build, so ordinary pull requests do not require access to signing secrets.
