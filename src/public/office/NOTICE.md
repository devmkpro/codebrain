Pixel Agents office, bundled in Codebrain
=========================================

Source: https://github.com/pixel-agents-hq/pixel-agents (commit 4dd14d612fd37d89ffbbc977959f572395c4eec8)
License: MIT, see LICENSE in this folder (Copyright (c) 2026 Pablo De Lucca).
Character art is based on "Metro City" by JIK-A-4: https://jik-a-4.itch.io/metrocity-free-topdown-character-pack

This is a built copy of the webview-ui with Codebrain changes:
- transport/codebrainTransport.ts: talks to the host Codebrain pane via postMessage (?host=codebrain)
- codebrain/rooms.ts: one room per workspace, named after the project, one desk per agent
- office/engine: visitAgent(), a character walks to another one when a pane messages another
- hooks/useExtensionMessages.ts: codebrainRooms, codebrainVisit, codebrainAgentMeta messages

Rebuild: in the fork, run "npm run build" inside webview-ui and copy dist/webview here.
