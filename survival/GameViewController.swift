//
//  GameViewController.swift
//  survival
//
//  Hosts Frostwood Camp (Three.js build bundled as game.html) in a full-screen WKWebView.
//  Native bridge: haptics + a UserDefaults mirror of the save file.
//

import UIKit
import WebKit

class GameViewController: UIViewController, WKScriptMessageHandler {

    private var webView: WKWebView!
    private let saveKey = "frostwood.save"

    override func loadView() {
        let controller = WKUserContentController()

        // Hand the native save to the game before any of its scripts run.
        let saved = UserDefaults.standard.string(forKey: saveKey) ?? ""
        let encoded = (try? JSONSerialization.data(withJSONObject: [saved]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        let bootstrap = "window.__NATIVE_SAVE__ = \(encoded)[0] || undefined;"
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))

        let proxy = WeakMessageHandler(self)
        controller.add(proxy, name: "haptic")
        controller.add(proxy, name: "save")

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = true
        webView.backgroundColor = UIColor(red: 0.81, green: 0.89, blue: 0.95, alpha: 1)
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsLinkPreview = false
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()

        if let url = Bundle.main.url(forResource: "game", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        } else {
            webView.loadHTMLString("<h2 style='font-family:-apple-system;padding:40px'>game.html is missing — run <code>npm run build</code> in /web</h2>", baseURL: nil)
        }

        NotificationCenter.default.addObserver(self, selector: #selector(appWillResignActive),
                                               name: UIApplication.willResignActiveNotification, object: nil)
    }

    /// Flush the save when the app is backgrounded (in addition to the game's own autosave).
    @objc private func appWillResignActive() {
        webView.evaluateJavaScript("window.__frostwoodSave && window.__frostwoodSave()", completionHandler: nil)
    }

    // MARK: - JS bridge

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.name {
        case "haptic":
            playHaptic(message.body as? String ?? "light")
        case "save":
            let json = message.body as? String ?? ""
            if json.isEmpty {
                UserDefaults.standard.removeObject(forKey: saveKey)
            } else {
                UserDefaults.standard.set(json, forKey: saveKey)
            }
        default:
            break
        }
    }

    private func playHaptic(_ style: String) {
        switch style {
        case "success":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning":
            UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "heavy":
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
        case "medium":
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        default:
            UIImpactFeedbackGenerator(style: .light).impactOccurred(intensity: 0.7)
        }
    }

    // MARK: - Presentation

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .portrait }
    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
}

/// Avoids the retain cycle WKUserContentController creates with its message handlers.
private final class WeakMessageHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(userContentController, didReceive: message)
    }
}
