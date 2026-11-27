import UIKit
import Capacitor

// Keep fixed and sticky web controls inside UIKit's usable area, including after rotation.
private final class ReaderWindowController: UIViewController {
    private let reader = CAPBridgeViewController()
    private let composer = ChatComposer(frame: .zero)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        addChild(reader)
        let content = reader.view!
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        composer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(composer)
        composer.webView = reader.webView
        reader.webView?.configuration.userContentController.add(composer, name: "chatComposer")
        let area = view.safeAreaLayoutGuide
        let fullHeight = content.bottomAnchor.constraint(equalTo: area.bottomAnchor)
        let aboveComposer = content.bottomAnchor.constraint(equalTo: composer.topAnchor)
        composer.visibilityChanged = { [weak self] visible in
            if visible {
                fullHeight.isActive = false
                aboveComposer.isActive = true
            } else {
                aboveComposer.isActive = false
                fullHeight.isActive = true
            }
            self?.view.layoutIfNeeded()
        }
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: area.topAnchor),
            fullHeight,
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            composer.leadingAnchor.constraint(equalTo: area.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: area.trailingAnchor),
            content.leadingAnchor.constraint(equalTo: area.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: area.trailingAnchor)
        ])
        reader.didMove(toParent: self)
    }

    override var childForStatusBarStyle: UIViewController? { reader }
    override var childForStatusBarHidden: UIViewController? { reader }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { reader.supportedInterfaceOrientations }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = ReaderWindowController()
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
