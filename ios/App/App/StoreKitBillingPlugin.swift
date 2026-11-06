import Foundation
import StoreKit
import Capacitor

/// StoreKit is the source of truth. No simulated purchases or local subscription flags.
@objc(StoreKitBillingPlugin)
public final class StoreKitBillingPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "StoreKitBillingPlugin"
    public let jsName = "AilyBilling"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "products", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "entitlement", returnType: CAPPluginReturnPromise)
    ]

    private static let productMultipliers: [String: Int] = [
        "com.aily.app.monthly.5x": 5,
        "com.aily.app.monthly.10x": 10,
        "com.aily.app.monthly.20x": 20,
        "com.aily.app.monthly.50x": 50
    ]
    private var transactionUpdatesTask: Task<Void, Never>?

    public override func load() {
        // Start immediately, so Ask to Buy approvals/renewals/refunds are handled
        // even when there is no purchase call waiting for a response.
        transactionUpdatesTask = Task { [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard !Task.isCancelled else { return }
                guard case .verified(let transaction) = result,
                      Self.productMultipliers[transaction.productID] != nil else { continue }
                await transaction.finish()
                let current = await Self.currentEntitlement()
                await MainActor.run { [weak self] in
                    self?.notifyListeners("entitlementChanged", data: ["entitlement": current])
                }
            }
        }
    }

    deinit {
        transactionUpdatesTask?.cancel()
    }

    @objc public func products(_ call: CAPPluginCall) {
        Task {
            do {
                let storeProducts = try await Product.products(for: Array(Self.productMultipliers.keys))
                let products = storeProducts.filter { $0.type == .autoRenewable }.sorted {
                    (Self.productMultipliers[$0.id] ?? 0) < (Self.productMultipliers[$1.id] ?? 0)
                }.map { product -> [String: Any] in
                    ["id": product.id,
                     "displayName": product.displayName,
                     "description": product.description,
                     "displayPrice": product.displayPrice]
                }
                call.resolve(["products": products])
            } catch {
                call.reject("Unable to load App Store subscriptions: \(error.localizedDescription)", "PRODUCTS_FAILED", error)
            }
        }
    }

    @objc public func purchase(_ call: CAPPluginCall) {
        guard let productID = call.getString("productId"),
              Self.productMultipliers[productID] != nil else {
            call.reject("A supported productId is required.", "INVALID_PRODUCT")
            return
        }
        Task { [weak self] in
            do {
                guard let product = try await Product.products(for: [productID]).first,
                      product.id == productID, product.type == .autoRenewable else {
                    call.reject("This subscription is unavailable from the App Store.", "PRODUCT_UNAVAILABLE")
                    return
                }
                switch try await product.purchase() {
                case .success(let result):
                    guard case .verified(let transaction) = result,
                          transaction.productID == productID else {
                        // Never grant entitlement or finish an unverified transaction.
                        call.reject("The App Store transaction could not be verified.", "UNVERIFIED_TRANSACTION")
                        return
                    }
                    await transaction.finish()
                    let current = await Self.currentEntitlement()
                    call.resolve(["status": "purchased", "entitlement": current])
                    await MainActor.run { [weak self] in
                        self?.notifyListeners("entitlementChanged", data: ["entitlement": current])
                    }
                case .pending:
                    // Ask to Buy is not a purchase. Transaction.updates delivers approval later.
                    call.resolve(["status": "pending"])
                case .userCancelled:
                    call.resolve(["status": "cancelled"])
                @unknown default:
                    call.reject("The App Store returned an unknown purchase result.", "UNKNOWN_PURCHASE_RESULT")
                }
            } catch {
                call.reject("App Store purchase failed: \(error.localizedDescription)", "PURCHASE_FAILED", error)
            }
        }
    }

    @objc public func restore(_ call: CAPPluginCall) {
        Task { [weak self] in
            do {
                try await AppStore.sync()
                let current = await Self.currentEntitlement()
                call.resolve(["entitlement": current])
                await MainActor.run { [weak self] in
                    self?.notifyListeners("entitlementChanged", data: ["entitlement": current])
                }
            } catch {
                call.reject("App Store restore failed: \(error.localizedDescription)", "RESTORE_FAILED", error)
            }
        }
    }

    @objc public func entitlement(_ call: CAPPluginCall) {
        Task {
            call.resolve(["entitlement": await Self.currentEntitlement()])
        }
    }

    private static func currentEntitlement() async -> [String: Any] {
        var selected: StoreKit.Transaction?
        var multiplier = 1
        let now = Date()
        for await result in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let transaction) = result,
                  let candidateMultiplier = productMultipliers[transaction.productID],
                  transaction.productType == .autoRenewable,
                  transaction.revocationDate == nil,
                  !transaction.isUpgraded,
                  let expiration = transaction.expirationDate,
                  expiration > now else { continue }
            // If separate subscription groups ever overlap, choose the highest tier,
            // then latest expiration deterministically. Unverified entries grant nothing.
            if candidateMultiplier > multiplier ||
                (candidateMultiplier == multiplier && expiration > (selected?.expirationDate ?? .distantPast)) {
                selected = transaction
                multiplier = candidateMultiplier
            }
        }
        guard let transaction = selected, let expiration = transaction.expirationDate else {
            return ["productId": NSNull(), "multiplier": 1, "expiresAt": NSNull()]
        }
        return ["productId": transaction.productID,
                "multiplier": multiplier,
                "expiresAt": ISO8601DateFormatter().string(from: expiration)]
    }
}
