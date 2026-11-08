// Cinecode Studio for macOS: shows the local panel in its own window (WKWebView).
// bin/cinecode-studio --serve starts the server; closing the window leaves productions running.
import AppKit
import WebKit

let port = 4910
let home = URL(string: "http://localhost:\(port)/")!
let repo = Bundle.main.object(forInfoDictionaryKey: "CSRepoDir") as? String ?? NSHomeDirectory() + "/Developer/cinecode-studio"

final class App: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
  var window: NSWindow!
  var web: WKWebView!

  func applicationDidFinishLaunching(_ n: Notification) {
    buildMenu()
    let cfg = WKWebViewConfiguration()
    cfg.preferences.setValue(true, forKey: "developerExtrasEnabled")
    cfg.preferences.isElementFullscreenEnabled = true
    cfg.mediaTypesRequiringUserActionForPlayback = []
    web = WKWebView(frame: .zero, configuration: cfg)
    web.navigationDelegate = self
    web.uiDelegate = self
    web.setValue(false, forKey: "drawsBackground")

    window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
                      styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
    window.title = "Cinecode Studio"
    window.titlebarAppearsTransparent = true
    window.backgroundColor = NSColor(name: nil) { a in
      a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
        ? NSColor(srgbRed: 0x0d/255, green: 0x0e/255, blue: 0x10/255, alpha: 1)
        : NSColor(srgbRed: 0xf4/255, green: 0xf4/255, blue: 0xf2/255, alpha: 1)
    }
    window.minSize = NSSize(width: 760, height: 560)
    window.contentView = web
    window.delegate = self
    window.center()
    window.setFrameAutosaveName("CinecodeStudioMain")
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    DispatchQueue.global().async {
      self.startServer()
      DispatchQueue.main.async { self.web.load(URLRequest(url: home)) }
    }
  }

  // bin/cinecode-studio leaves a running server alone; otherwise it starts one and waits for the port.
  func startServer() {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/zsh")
    p.arguments = [repo + "/bin/cinecode-studio", "--serve"]
    var env = ProcessInfo.processInfo.environment
    let h = NSHomeDirectory()
    let nvm = (try? FileManager.default.contentsOfDirectory(atPath: h + "/.nvm/versions/node"))?.sorted().last.map { "\(h)/.nvm/versions/node/\($0)/bin" } ?? ""
    env["PATH"] = ["\(h)/.local/bin", "\(h)/.bun/bin", "\(h)/.volta/bin", "\(h)/Library/pnpm", nvm,
                   "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin"].filter { !$0.isEmpty }.joined(separator: ":")
    p.environment = env
    try? p.run()
    p.waitUntilExit()
  }

  // Links outside the panel open in the default browser.
  func isPanel(_ u: URL?) -> Bool { u?.host == "localhost" && u?.port == port }

  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let u = a.request.url, a.targetFrame?.isMainFrame != false, !isPanel(u), u.scheme != "about" {
      NSWorkspace.shared.open(u); return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url { NSWorkspace.shared.open(u) }
    return nil
  }

  // File picker for <input type=file>.
  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let op = NSOpenPanel(); op.allowsMultipleSelection = p.allowsMultipleSelection; op.canChooseDirectories = false
    op.beginSheetModal(for: window) { r in completionHandler(r == .OK ? op.urls : nil) }
  }

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let al = NSAlert(); al.messageText = m; al.runModal(); completionHandler()
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let al = NSAlert(); al.messageText = m; al.addButton(withTitle: "OK"); al.addButton(withTitle: "Cancel")
    completionHandler(al.runModal() == .alertFirstButtonReturn)
  }

  // If the server is not up yet, retry briefly (about 10 s at most).
  var retries = 0
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    guard retries < 40 else { return }
    retries += 1
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { w.load(URLRequest(url: home)) }
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { retries = 0 }

  func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows v: Bool) -> Bool {
    if !v { window.makeKeyAndOrderFront(nil) }
    return true
  }

  @objc func reload() { retries = 0; web.load(URLRequest(url: home)) }

  func buildMenu() {
    let main = NSMenu()
    func add(_ title: String, _ items: [NSMenuItem]) {
      let it = NSMenuItem(); let m = NSMenu(title: title); items.forEach(m.addItem); it.submenu = m; main.addItem(it)
    }
    func item(_ t: String, _ s: Selector?, _ k: String, _ mods: NSEvent.ModifierFlags = .command) -> NSMenuItem {
      let i = NSMenuItem(title: t, action: s, keyEquivalent: k); i.keyEquivalentModifierMask = mods; return i
    }
    add("Cinecode Studio", [item("Cinecode Studio Hakkında", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), ""), .separator(),
                      item("Gizle", #selector(NSApplication.hide(_:)), "h"), .separator(),
                      item("Çık", #selector(NSApplication.terminate(_:)), "q")])
    add("Düzen", [item("Geri Al", Selector(("undo:")), "z"), item("Yinele", Selector(("redo:")), "z", [.command, .shift]), .separator(),
                  item("Kes", #selector(NSText.cut(_:)), "x"), item("Kopyala", #selector(NSText.copy(_:)), "c"),
                  item("Yapıştır", #selector(NSText.paste(_:)), "v"), item("Tümünü Seç", #selector(NSText.selectAll(_:)), "a")])
    let r = item("Yenile", #selector(reload), "r"); r.target = self
    add("Görünüm", [r, item("Tam Ekran", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control])])
    add("Pencere", [item("Kapat", #selector(NSWindow.performClose(_:)), "w"), item("Küçült", #selector(NSWindow.miniaturize(_:)), "m")])
    NSApp.mainMenu = main
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
