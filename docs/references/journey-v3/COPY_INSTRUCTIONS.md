# Copy instructions — Mac / VS Code

Target project:

`/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio`

Final destination:

`/Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio/docs/references/journey-v3`

## Finder / VS Code method

1. Unzip `Journey_Codex_Reference_Pack_v3.zip`.
2. Open the portfolio project in VS Code.
3. In VS Code Explorer, open `docs`.
4. Create a folder named `references` if it does not already exist.
5. Open `docs/references`.
6. Drag the extracted `journey-v3` folder into `docs/references`.
7. Confirm that `REFERENCE_INDEX.md` appears at `docs/references/journey-v3/REFERENCE_INDEX.md`.
8. Open the integrated terminal and run `git status --short`.

Expected result:

`?? docs/references/journey-v3/`

## Terminal method

Assuming the extracted folder is in Downloads:

```bash
cd /Users/tsubo/Documents/Codex/2026-08-08/new-chat/portfolio
mkdir -p docs/references
cp -R ~/Downloads/Journey_Codex_Reference_Pack_v3/journey-v3 docs/references/
git status --short
```

Do not place this reference folder under `public/`.
