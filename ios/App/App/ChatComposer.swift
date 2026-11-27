import UIKit
import WebKit

/// The keyboard and its text input belong to UIKit. The web reader owns the
/// conversation, including its draft, selection, history and retry state.
final class ChatComposer: UIView, WKScriptMessageHandler, UITextViewDelegate {
    weak var webView: WKWebView?
    var visibilityChanged: ((Bool) -> Void)?

    private let input = UITextView()
    private let placeholder = UILabel()
    private let send = UIButton(type: .system)
    private var session = ""
    private var revision = 0
    private var canSend = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isHidden = true
        input.font = .preferredFont(forTextStyle: .body)
        input.adjustsFontForContentSizeCategory = true
        input.accessibilityLabel = "关于本书的问题"
        input.accessibilityIdentifier = "chat-input-native"
        input.returnKeyType = .send
        input.delegate = self
        input.inputAccessoryView = nil
        input.inputAssistantItem.leadingBarButtonGroups = []
        input.inputAssistantItem.trailingBarButtonGroups = []
        input.textContainerInset = UIEdgeInsets(top: 10, left: 10, bottom: 10, right: 10)
        input.layer.cornerRadius = 12
        input.layer.borderWidth = 1
        input.textColor = .label

        placeholder.text = "输入关于本书的问题…"
        placeholder.textColor = .placeholderText
        placeholder.font = input.font
        placeholder.adjustsFontForContentSizeCategory = true
        placeholder.isAccessibilityElement = false
        placeholder.isUserInteractionEnabled = false

        send.accessibilityLabel = "发送消息"
        send.setImage(UIImage(systemName: "arrow.right"), for: .normal)
        send.tintColor = .white
        send.backgroundColor = UIColor(red: 0.32, green: 0.42, blue: 0.28, alpha: 1)
        send.layer.cornerRadius = 10
        send.addTarget(self, action: #selector(submit), for: .touchUpInside)

        for item in [input, placeholder, send] {
            addSubview(item)
            item.translatesAutoresizingMaskIntoConstraints = false
        }
        NSLayoutConstraint.activate([
            input.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            input.topAnchor.constraint(equalTo: topAnchor, constant: 6),
            input.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
            input.heightAnchor.constraint(equalToConstant: 60),
            placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 15),
            placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 10),
            send.leadingAnchor.constraint(equalTo: input.trailingAnchor, constant: 8),
            send.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            send.centerYAnchor.constraint(equalTo: input.centerYAnchor),
            send.widthAnchor.constraint(equalToConstant: 44),
            send.heightAnchor.constraint(equalToConstant: 44)
        ])
    }

    required init?(coder: NSCoder) { fatalError("Use init(frame:)") }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == "capacitor",
              message.frameInfo.securityOrigin.host == "localhost",
              let data = message.body as? [String: Any], let action = data["action"] as? String else { return }
        switch action {
        case "hide":
            input.resignFirstResponder()
            if !isHidden { isHidden = true; visibilityChanged?(false) }
        case "blur":
            input.resignFirstResponder()
        case "focus":
            if !isHidden && data["session"] as? String == session { input.becomeFirstResponder() }
        case "show":
            guard let id = data["session"] as? String, let version = data["revision"] as? Int,
                  let draft = data["draft"] as? String else { return }
            if session != id { session = id; revision = version; input.text = draft }
            // An asynchronous history update must not overwrite unacknowledged keystrokes or IME composition.
            if revision == version && input.markedTextRange == nil && input.text != draft { input.text = draft }
            canSend = data["canSend"] as? Bool == true
            input.isEditable = data["editable"] as? Bool == true
            let theme = data["theme"] as? String
            overrideUserInterfaceStyle = theme == "night" ? .dark : .light
            backgroundColor = theme == "night" ? UIColor(white: 0.15, alpha: 1) :
                (theme == "sage" ? UIColor(red: 0.94, green: 0.95, blue: 0.91, alpha: 1) :
                    UIColor(red: 0.98, green: 0.97, blue: 0.94, alpha: 1))
            input.backgroundColor = backgroundColor
            input.layer.borderColor = UIColor.separator.resolvedColor(with: traitCollection).cgColor
            refreshButtons()
            if isHidden { isHidden = false; visibilityChanged?(true) }
        default: break
        }
    }

    private func refreshButtons() {
        placeholder.isHidden = !input.text.isEmpty
        send.isEnabled = canSend && input.isEditable && input.markedTextRange == nil &&
            !input.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        send.alpha = send.isEnabled ? 1 : 0.45
    }

    private func publish(submit: Bool) {
        let detail: [String: Any] = ["session": session, "revision": revision, "text": input.text ?? "", "submit": submit]
        webView?.callAsyncJavaScript("window.dispatchEvent(new CustomEvent('modu-composer', {detail}))",
                                     arguments: ["detail": detail], in: nil, in: .page, completionHandler: nil)
    }

    func textViewDidChange(_ textView: UITextView) {
        if input.markedTextRange == nil && input.text.utf16.count > 2000 {
            var clipped = ""
            for character in input.text {
                if clipped.utf16.count + String(character).utf16.count > 2000 { break }
                clipped.append(character)
            }
            input.text = clipped
        }
        revision += 1
        refreshButtons()
        publish(submit: false)
    }

    func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText text: String) -> Bool {
        if text == "\n" && input.markedTextRange == nil { submit(); return false }
        return true
    }

    @objc private func submit() {
        guard send.isEnabled else { return }
        send.isEnabled = false
        publish(submit: true)
    }
}
