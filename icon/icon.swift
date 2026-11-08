// Cinecode Studio icon: black squircle, film perforations, a white play triangle and a neon green record dot.
import AppKit
let S: CGFloat = 1024
let img = NSImage(size: NSSize(width: S, height: S))
img.lockFocus()
let ctx = NSGraphicsContext.current!.cgContext
let body = CGRect(x: 100, y: 100, width: 824, height: 824)
let path = NSBezierPath(roundedRect: body, xRadius: 185, yRadius: 185)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: -14), blur: 36, color: NSColor.black.withAlphaComponent(0.35).cgColor)
NSColor.black.setFill(); path.fill()
ctx.restoreGState()
path.addClip()
NSGradient(colors: [NSColor(white: 0.13, alpha: 1), NSColor(white: 0.02, alpha: 1)])!.draw(in: body, angle: -90)
// film perforations top and bottom
NSColor(white: 1, alpha: 0.14).setFill()
for i in 0..<6 {
  let x = 220 + CGFloat(i) * 104
  NSBezierPath(roundedRect: CGRect(x: x, y: 800, width: 64, height: 56), xRadius: 14, yRadius: 14).fill()
  NSBezierPath(roundedRect: CGRect(x: x, y: 168, width: 64, height: 56), xRadius: 14, yRadius: 14).fill()
}
let c = NSPoint(x: 530, y: 512)
let tri = NSBezierPath()
tri.move(to: NSPoint(x: c.x - 120, y: c.y + 190)); tri.line(to: NSPoint(x: c.x + 180, y: c.y)); tri.line(to: NSPoint(x: c.x - 120, y: c.y - 190)); tri.close()
tri.lineJoinStyle = .round; tri.lineWidth = 60
// One-colour fill and stroke: rounded corners, no seam.
NSColor.white.set(); tri.fill(); tri.stroke()
// neon record dot, top right
let neon = NSColor(srgbRed: 0.24, green: 1, blue: 0.48, alpha: 1)
let dot = CGRect(x: 716, y: 676, width: 92, height: 92)
NSGradient(colors: [neon.withAlphaComponent(0.45), .clear])!.draw(fromCenter: NSPoint(x: dot.midX, y: dot.midY), radius: 0, toCenter: NSPoint(x: dot.midX, y: dot.midY), radius: 120, options: [])
neon.setFill(); NSBezierPath(ovalIn: dot).fill()
img.unlockFocus()
let rep = NSBitmapImageRep(data: img.tiffRepresentation!)!
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
