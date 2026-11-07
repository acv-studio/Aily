import Foundation
import UIKit
import MessageUI
import Capacitor

/// User-initiated feedback only. No credentials, background sending, or message logging.
@objc(FeedbackMailPlugin)
public final class FeedbackMailPlugin: CAPPlugin, CAPBridgedPlugin, MFMailComposeViewControllerDelegate {
    public let identifier = "FeedbackMailPlugin"
    public let jsName = "FeedbackMail"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "compose", returnType: CAPPluginReturnPromise)
    ]

    private static let recipient = "1756563255@qq.com"
    // All composer/call state is accessed on the main queue. Retain until dismissal completes.
    private var mailCall: CAPPluginCall?
    private var mailComposer: MFMailComposeViewController?
    private var finishing = false

    @objc public func compose(_ call: CAPPluginCall) {
        guard let subject = call.getString("subject"),
              !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              subject.utf16.count <= 200,
              subject.rangeOfCharacter(from: .newlines) == nil else {
            call.reject("Subject must be nonempty, at most 200 characters, and contain no newlines.", "INVALID_SUBJECT")
            return
        }
        guard let body = call.getString("body"),
              !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              body.utf16.count <= 10000 else {
            call.reject("Body must be nonempty and at most 10000 characters.", "INVALID_BODY")
            return
        }

        DispatchQueue.main.async {
            guard self.mailCall == nil else {
                call.reject("A feedback mail operation is already in progress.", "COMPOSE_IN_PROGRESS")
                return
            }
            guard let presenter = self.availablePresenter() else {
                call.reject("Feedback mail cannot be presented right now. Try again when the app is active.", "PRESENTATION_UNAVAILABLE")
                return
            }
            self.mailCall = call
            self.finishing = false

            // Check only in response to this explicit compose call, never during plugin load.
            guard MFMailComposeViewController.canSendMail() else {
                self.openSystemMail(subject: subject, body: body)
                return
            }

            let composer = MFMailComposeViewController()
            composer.mailComposeDelegate = self
            composer.setToRecipients([Self.recipient]) // Never read a recipient from JavaScript.
            composer.setSubject(subject)
            composer.setMessageBody(body, isHTML: false)
            // Delegate handles every exit; prevent a swipe from bypassing its result callback.
            composer.modalPresentationStyle = .fullScreen
            composer.isModalInPresentation = true
            self.mailComposer = composer
            presenter.present(composer, animated: true) {
                guard self.mailComposer === composer, !self.finishing else { return }
                if composer.presentingViewController == nil {
                    self.finish(status: nil, rejectionCode: "PRESENTATION_UNAVAILABLE")
                }
            }
            // UIKit assigns presentingViewController synchronously on successful presentation.
            // If presentation was refused, do not leave the JS promise permanently pending.
            if composer.presentingViewController == nil {
                self.finish(status: nil, rejectionCode: "PRESENTATION_UNAVAILABLE")
            }
        }
    }

    private func availablePresenter() -> UIViewController? {
        guard let root = bridge?.viewController,
              let window = root.viewIfLoaded?.window,
              !window.isHidden,
              window.windowScene?.activationState == .foregroundActive else { return nil }
        var presenter: UIViewController = root
        while true {
            // Never stack mail composers (including one presented by a different plugin).
            guard !(presenter is MFMailComposeViewController),
                  !presenter.isBeingPresented, !presenter.isBeingDismissed,
                  presenter.transitionCoordinator == nil else { return nil }
            if let presented = presenter.presentedViewController {
                presenter = presented
            } else if let navigation = presenter as? UINavigationController,
                      let visible = navigation.visibleViewController {
                presenter = visible
            } else if let tabs = presenter as? UITabBarController,
                      let selected = tabs.selectedViewController {
                presenter = selected
            } else {
                break
            }
        }
        guard !(presenter is UIAlertController), presenter.viewIfLoaded?.window === window else { return nil }
        return presenter
    }

    private func openSystemMail(subject: String, body: String) {
        // RFC 6068 body line breaks use CRLF. Encode only unreserved characters literally,
        // so Unicode, &, ?, +, %, # and all line breaks remain query values, not headers.
        let normalizedBody = body.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .replacingOccurrences(of: "\n", with: "\r\n")
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encodedSubject = subject.addingPercentEncoding(withAllowedCharacters: unreserved),
              let encodedBody = normalizedBody.addingPercentEncoding(withAllowedCharacters: unreserved),
              let url = URL(string: "mailto:\(Self.recipient)?subject=\(encodedSubject)&body=\(encodedBody)") else {
            finish(status: nil, rejectionCode: "MAIL_UNAVAILABLE")
            return
        }
        // Use open's actual completion, not canOpenURL (no query-scheme plist changes needed).
        UIApplication.shared.open(url, options: [:]) { opened in
            DispatchQueue.main.async {
                // "opened" means only that iOS accepted the handoff, never that mail was sent.
                self.finish(status: opened ? "opened" : nil,
                            rejectionCode: opened ? nil : "MAIL_UNAVAILABLE")
            }
        }
    }

    public func mailComposeController(_ controller: MFMailComposeViewController,
                                      didFinishWith result: MFMailComposeResult, error: Error?) {
        guard controller === mailComposer, mailCall != nil, !finishing else { return }
        let status: String?
        if error != nil {
            status = nil
        } else {
            switch result {
            case .sent: status = "sent"
            case .saved: status = "saved"
            case .cancelled: status = "cancelled"
            case .failed: status = nil
            @unknown default: status = nil
            }
        }
        finish(status: status, rejectionCode: status == nil ? "MAIL_FAILED" : nil)
    }

    private func finish(status: String?, rejectionCode: String?) {
        guard let call = mailCall, !finishing else { return }
        finishing = true
        let complete = {
            self.mailComposer?.mailComposeDelegate = nil
            self.mailComposer = nil
            self.mailCall = nil
            self.finishing = false
            if let status = status {
                call.resolve(["status": status])
            } else {
                let code = rejectionCode ?? "MAIL_FAILED"
                let message: String
                switch code {
                case "MAIL_UNAVAILABLE": message = "No mail app is available. Copy the feedback and send it manually."
                case "PRESENTATION_UNAVAILABLE": message = "Unable to present the feedback mail composer."
                default: message = "The mail composer reported an error. Feedback was not confirmed sent."
                }
                // Do not include framework error details that might contain message content.
                call.reject(message, code)
            }
        }
        if let composer = mailComposer, composer.presentingViewController != nil {
            composer.dismiss(animated: true, completion: complete)
        } else {
            complete()
        }
    }
}
