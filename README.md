# Cinecode Studio

A desktop production panel for making films with code. Write an idea (or paste your own script), answer a few questions written for that idea, read and edit the script and cut, and Claude Code produces the film on your own machine. Watch it progress, give notes, get the final, then edit it with HyperFrames: captions, titles, lower thirds, logo, transitions, music.

Built on **[cinecode](https://github.com/sarpstar/cinecode)** by Sarp Yıldız ([@sarpstar](https://x.com/sarpstar)), the open-source skill that writes, builds, scores and renders the film. Cinecode Studio does not change cinecode; it gives it a panel. Editing uses **[HyperFrames](https://github.com/heygen-com/hyperframes)** by HeyGen.

[Türkçe](#türkçe)

## Install with an AI agent

Paste this into Claude Code (or any coding agent with shell access):

```
Install Cinecode Studio from https://github.com/hsynozdamar-byte/cinecode-studio and follow AGENTS.md in that repo.
```

The agent checks the requirements, installs cinecode and HyperFrames, clones this repo and creates the Desktop shortcut. [AGENTS.md](AGENTS.md) holds the exact steps.

## Install by hand

Requirements: [Claude Code](https://claude.ai/code) signed in, Node.js 22+, Python 3, ffmpeg, Google Chrome.

```bash
# 1. cinecode, the skill that makes the film
git clone https://github.com/sarpstar/cinecode.git ~/.claude/skills/cinecode

# 2. HyperFrames, for editing (optional)
claude plugin marketplace add heygen-com/hyperframes
claude plugin install hyperframes@hyperframes

# 3. This panel
git clone https://github.com/hsynozdamar-byte/cinecode-studio.git ~/cinecode-studio
cd ~/cinecode-studio
./install.sh                                            # macOS, Linux
powershell -ExecutionPolicy Bypass -File install.ps1    # Windows
```

Then open **Cinecode Studio** from the Desktop.

## What it does

| Area | What you get |
|---|---|
| New project | Idea, or your own script (pasted or from a .txt/.md file, with a read-time estimate and "fit length to script"); reference images, a reference folder, a reference video, your own music |
| Picture | Aspect 16:9, 9:16, 1:1, 4:5; 720p, 1080p, 4K; 24, 30, 60 fps; length from 5 s to 30 min |
| Sound | Narration with Gemini, ElevenLabs or a local offline voice; voice gender and tone; ElevenLabs voice ID; open-licence music, music written in code, or your file; captions |
| Questions | 3 to 5 questions written for your idea, with the recommended answer preselected |
| Script | Before anything renders: title, logline, look and a timed scene list (shot, narration, sound) on a cut timeline. Edit any line, delete a scene, or give a note and have it rewritten. The approved script is binding for the production |
| Production | Live steps read from the film's STATE.md, activity log, stills, drafts and final in one player |
| Revise | The production delivers the final; notes go back to the same session and come back as a new final |
| Edit | HyperFrames edits on any version: captions, title card, lower thirds, logo, end card, transitions, music, sound effects, colour, vertical reframe. Rendered locally |
| Clone | Pick a video and HyperFrames' reverse-any-video rebuilds it as an editable HyperFrames project, optionally with your changes (text, logo, colours). Needs HyperFrames Pro; paid re-shoots and cloud render stay off; renders locally |
| Library | Every project with its poster, status and versions. A bundled example ("Kâğıt Gemi", a 15 s draft cinecode made in 17 minutes) shows a finished run on first launch; hide it in Settings |
| Settings | API keys stored in cinecode's local key store (never shown again), output folder, tool check, credits |

## How it works

- `server.mjs` is a small Node server on `http://localhost:4910` (localhost only). `index.html` is the panel.
- Questions come from `claude -p --json-schema` (Sonnet). A production is `claude -p` running the cinecode skill with your brief, streaming its progress to the panel; notes and finals resume the same session.
- Edits are a separate `claude -p` session running the HyperFrames skill on the video you picked. Renders are local; the brief forbids cloud render and paid generation.
- Productions run with `--permission-mode bypassPermissions` inside the output folder, so they can work unattended. Read the cinecode and HyperFrames docs if you want to know what they run.
- Keys are written with cinecode's `keys.py` to `~/.cinecode/keys.env` (mode 600). Films are saved to `~/Desktop/Cinecode Films` unless you choose another folder.
- Nothing leaves your machine except what Claude Code, cinecode and HyperFrames themselves send (model calls, stock and TTS APIs you connect, HyperFrames' usage telemetry).

## Credits

- [cinecode](https://github.com/sarpstar/cinecode), MIT, by Sarp Yıldız: the film-making skill this panel drives.
- [HyperFrames](https://github.com/heygen-com/hyperframes), Apache-2.0, by HeyGen: the editing layer.
- Cinecode Studio, MIT, by Hüseyin Özdamar ([@designvibed](https://x.com/designvibed)).

---

## Türkçe

Kodla film yapmak için masaüstü üretim paneli. Fikrini (ya da kendi metnini) yaz, fikrine göre yazılan birkaç soruyu cevapla, biçimi seç; film kendi bilgisayarında Claude Code ile üretilsin. İlerlemeyi izle, not ver, finali al, sonra HyperFrames ile düzenle: altyazı, başlık, alt bant, logo, geçiş, müzik.

Filmi yazan, kuran, seslendiren ve render eden açık kaynak skill **[cinecode](https://github.com/sarpstar/cinecode)** Sarp Yıldız'ın ([@sarpstar](https://x.com/sarpstar)) eseridir; Cinecode Studio onu değiştirmez, ona bir panel verir.

**Kurulum:** Claude Code'a şunu yapıştır:

```
Cinecode Studio'yu https://github.com/hsynozdamar-byte/cinecode-studio adresinden kur; repodaki AGENTS.md'yi izle.
```

Elle kurulum yukarıdaki "Install by hand" adımlarıyla aynıdır.
