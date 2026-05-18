# build

Build the Codebrain application for development or production.

## Usage
```
/build [options]
```

## Options
- `--dev` — Development build (with hot reload)
- `--prod` — Production build (optimized)
- `--platform <os>` — Target platform (win, mac, linux)
- `--release` — Build + bump version + tag

## Examples
```
/build --dev
/build --prod
/build --prod --platform win
/build --release
```

## What It Does

### Development (--dev)
```
npm run dev
# Starts Electron + Vite dev server with hot reload
```

### Production (--prod)
```
npm run build
# 1. electron-vite compiles main + preload
# 2. Vite compiles renderer
# 3. gen:releases.mjs generates releases-data.ts
# 4. electron-builder packages app
```

### Release (--release)
```
1. npm version patch  # or minor/major
2. npm run build
3. git add -A
4. git commit -m "chore: bump version to X.Y.Z"
5. git tag vX.Y.Z
6. git push origin master --tags
```

## Build Artifacts

```
dist/
  codebrain-setup-1.3.1.exe    # Windows installer
  codebrain-1.3.1.AppImage     # Linux AppImage
  codebrain-1.3.1.dmg          # macOS DMG
```

## Common Issues

### gen:releases overwrites manual edits
The `npm run build` script runs `gen:releases.mjs` which auto-generates `releases-data.ts` from git tags. Any manual edits will be overwritten.

### Version sorting bug
Fixed in v1.3.1. Uses semantic versioning comparator instead of lexicographic sorting.

### extraResources not bundled
Check `package.json` → `build.extraResources` → must include `resources/codebrain-skill/`.

## See Also
- `/test` — Run tests
- `/lint` — Run linter
