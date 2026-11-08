#!/bin/bash
# Cinecode Studio installer for macOS and Linux. Run from the repo folder: ./install.sh
# macOS: builds "/Applications/Cinecode Studio.app" (a native window around the local panel) and a Desktop alias.
# Linux: adds a launcher to the applications menu. Windows uses install.ps1.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
URL="http://localhost:4910"

if ! command -v node >/dev/null && ! ls -d "$HOME"/.nvm/versions/node/*/bin/node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node 22+ first (macOS: brew install node, Linux: your package manager)."; exit 1
fi
mkdir -p "$DIR/data"
chmod +x "$DIR/bin/cinecode-studio"

if [ "$(uname)" != "Darwin" ]; then
  mkdir -p "$HOME/.local/share/applications"
  cat > "$HOME/.local/share/applications/cinecode-studio.desktop" <<DESK
[Desktop Entry]
Type=Application
Name=Cinecode Studio
Exec=$DIR/bin/cinecode-studio
Icon=$DIR/icon/icon-1024.png
Categories=AudioVideo;Video;
DESK
  echo "Done: open Cinecode Studio from your applications menu, or run $DIR/bin/cinecode-studio"; exit 0
fi

APP="/Applications/Cinecode Studio.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$DIR/icon/CinecodeStudio.icns" "$APP/Contents/Resources/AppIcon.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Cinecode Studio</string>
<key>CFBundleDisplayName</key><string>Cinecode Studio</string>
<key>CFBundleIdentifier</key><string>local.cinecodestudio</string>
<key>CFBundleExecutable</key><string>CinecodeStudio</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.0</string>
<key>LSMinimumSystemVersion</key><string>12.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>CSRepoDir</key><string>$DIR</string>
</dict></plist>
PLIST

if command -v swiftc >/dev/null; then
  # Native window (WKWebView); no browser needed.
  swiftc -O -o "$APP/Contents/MacOS/CinecodeStudio" "$DIR/mac/CinecodeStudio.swift"
else
  # No Xcode Command Line Tools: start the server and open the panel as a Chrome app window.
  cat > "$APP/Contents/MacOS/CinecodeStudio" <<SH
#!/bin/bash
# Apps opened from Finder get an empty PATH; add the usual Node locations.
NVM_NODE=\$(ls -d "\$HOME"/.nvm/versions/node/*/bin 2>/dev/null | tail -1)
export PATH="\$HOME/.local/bin:\$HOME/.volta/bin:\$NVM_NODE:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin"
"$DIR/bin/cinecode-studio" --serve
if [ -d "/Applications/Google Chrome.app" ]; then open -na "Google Chrome" --args --app="$URL" --window-size=1280,860; else open "$URL"; fi
SH
  /usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$APP/Contents/Info.plist"
fi
chmod +x "$APP/Contents/MacOS/CinecodeStudio"
codesign --force -s - "$APP" 2>/dev/null || true
touch "$APP"

# Desktop alias (Finder). Deleting it removes only the shortcut; the app stays in Applications.
rm -rf "$HOME/Desktop/Cinecode Studio" "$HOME/Desktop/Cinecode Studio.app"
osascript -e "tell application \"Finder\" to make new alias file to (POSIX file \"$APP\") at desktop with properties {name:\"Cinecode Studio\"}" >/dev/null || true
echo "Done: double-click Cinecode Studio on your Desktop (the app lives in Applications)."
