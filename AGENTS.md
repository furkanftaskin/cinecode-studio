# Installing Cinecode Studio (for coding agents)

You are installing a local desktop panel that drives the cinecode skill through Claude Code. Work through the steps in order, on the user's OS. Ask before installing any system package; everything else needs no question. Speak to the user in their language.

## 1. Check the requirements

| Tool | Check | Install if missing (ask first) |
|---|---|---|
| Claude Code, signed in | `claude --version` | https://claude.ai/code (the user signs in themselves) |
| Node.js 22+ | `node -v` | macOS `brew install node` · Windows `winget install OpenJS.NodeJS` · Linux package manager |
| Python 3 | `python3 -V` (Windows: `py -3 -V`) | macOS ships it via Xcode CLT · Windows `winget install Python.Python.3.12` |
| ffmpeg | `ffmpeg -version` | macOS `brew install ffmpeg` · Windows `winget install Gyan.FFmpeg` · Linux `apt install ffmpeg` |
| Google Chrome | the app exists | macOS `brew install --cask google-chrome` · Windows `winget install Google.Chrome` |
| git | `git --version` | Windows `winget install --id Git.Git -e` |

On Windows, a program winget installs is only on PATH for apps started afterwards: after installing Node, Python or ffmpeg, ask the user to reopen the terminal or Claude Code, then continue.

## 2. Install cinecode (the film-making skill)

Skip if `~/.claude/skills/cinecode/SKILL.md` already exists (then `git -C ~/.claude/skills/cinecode pull`).

```bash
git clone https://github.com/sarpstar/cinecode.git ~/.claude/skills/cinecode
```

Windows path: `%USERPROFILE%\.claude\skills\cinecode`. Install it in one place only.

## 3. Install HyperFrames (editing, optional but recommended)

```bash
claude plugin marketplace add heygen-com/hyperframes
claude plugin install hyperframes@hyperframes
```

If the marketplace clone fails with a git-lfs error, install git-lfs (`brew install git-lfs` / `winget install GitHub.GitLFS`), run `git lfs install`, then retry.

## 4. Install the panel

```bash
git clone https://github.com/hsynozdamar-byte/cinecode-studio.git ~/cinecode-studio
cd ~/cinecode-studio
```

- macOS / Linux: `./install.sh` (macOS builds `/Applications/Cinecode Studio.app` with `swiftc` when Xcode Command Line Tools are present, otherwise a Chrome app window; adds a Desktop alias).
- Windows: `powershell -ExecutionPolicy Bypass -File install.ps1` (Desktop and Start menu shortcuts; opens in Edge or Chrome app mode).

The user may prefer another folder than `~/cinecode-studio`; the installers work from wherever the repo is.

## 5. Verify

Start the server once and check it answers:

```bash
node server.mjs &            # Windows: Start-Process node server.mjs
curl -s http://localhost:4910/api/status
```

`kit` and `hyperframes` should be `true`, and every entry in `tools` `true`. Stop that test server (by its PID only, never a broad pkill), then tell the user to open **Cinecode Studio** from the Desktop.

## 6. Tell the user

- Voice narration needs a free Gemini key (aistudio.google.com/apikey); stock footage a free Pixabay key. Both are added in the panel: Ayarlar › Kaynaklar. Keys stay in `~/.cinecode/keys.env` on this machine.
- Films are saved to `~/Desktop/Cinecode Films`; Ayarlar › Kayıt yeri changes it.
- A film runs as Claude Code on their plan; long films take hours. The panel can be closed while a film produces.

## Updating

```bash
git -C ~/cinecode-studio pull
git -C ~/.claude/skills/cinecode pull
claude plugin update hyperframes@hyperframes
```

Do not restart the server while a film is producing: a restart cuts the running session (the panel then offers "Kaldığı yerden devam").
