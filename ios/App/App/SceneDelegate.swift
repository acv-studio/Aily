import UIKit
import Capacitor
import WebKit

final class AilyBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(StoreKitBillingPlugin())
        bridge?.registerPluginInstance(PhotoOrganizerPlugin())
        bridge?.registerPluginInstance(FeedbackMailPlugin())
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { statusBarStyle }
    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarUpdateAnimation: UIStatusBarAnimation { .fade }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureScrollView(in: view)
    }

    private func configureScrollView(in root: UIView) {
        if let webView = root as? WKWebView {
            webView.scrollView.isScrollEnabled = true
            webView.scrollView.alwaysBounceVertical = true
            webView.scrollView.panGestureRecognizer.isEnabled = true
            webView.scrollView.contentInsetAdjustmentBehavior = .never
            webView.scrollView.showsVerticalScrollIndicator = false
            webView.scrollView.showsHorizontalScrollIndicator = false
            return
        }
        for child in root.subviews { configureScrollView(in: child) }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AilyBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
