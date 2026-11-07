import Foundation
import UIKit
import Photos
import Capacitor

/// Local library access only; no uploads. Deletion is explicit, bounded, and confirmed by Photos.
/// Only listPhotos may request library access; loading/deletion never prompt for access.
@objc(PhotoOrganizerPlugin)
public final class PhotoOrganizerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PhotoOrganizerPlugin"
    public let jsName = "PhotoOrganizer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPhoto", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deletePhotos", returnType: CAPPluginReturnPromise)
    ]
    private let worker = DispatchQueue(label: "com.aily.photo-organizer", qos: .userInitiated)
    private let imageManager = PHImageManager()
    private static let maximumDimension: CGFloat = 1600
    private static let maximumDeleteBatch = 500
    private var deletionPending = false // Accessed only on worker.

    @objc public func deletePhotos(_ call: CAPPluginCall) {
        guard let rawIds = call.getArray("ids"), rawIds.allSatisfy({ $0 is String }) else {
            call.reject("Photo ids must be an array of strings.", "INVALID_IDS")
            return
        }
        var seen = Set<String>()
        let ids = rawIds.compactMap { value -> String? in
            let id = (value as! String).trimmingCharacters(in: .whitespacesAndNewlines)
            return !id.isEmpty && seen.insert(id).inserted ? id : nil
        }
        guard ids.count <= Self.maximumDeleteBatch else {
            call.reject("Delete at most 500 photos at once.", "BATCH_TOO_LARGE")
            return
        }
        guard !ids.isEmpty else {
            call.resolve(["deletedIds": [String]()])
            return
        }
        // Never request access here, including when authorization is notDetermined.
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.reject("Photo access is not granted. Call listPhotos explicitly to request access.", "PERMISSION_DENIED")
            return
        }
        worker.async {
            guard !self.deletionPending else {
                call.reject("A photo deletion confirmation is already open.", "DELETE_IN_PROGRESS")
                return
            }
            let assets = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
            var images = [PHAsset]()
            assets.enumerateObjects { asset, _, _ in
                if asset.mediaType == .image { images.append(asset) }
            }
            // Validate the complete image batch before submitting any mutation.
            guard images.count == ids.count, Set(images.map { $0.localIdentifier }) == Set(ids) else {
                call.reject("One or more photos are missing or are no longer accessible.", "PHOTO_NOT_FOUND")
                return
            }
            self.deletionPending = true
            DispatchQueue.main.async {
                PHPhotoLibrary.shared().performChanges({
                    PHAssetChangeRequest.deleteAssets(images as NSArray)
                }) { success, error in
                    self.worker.async {
                        self.deletionPending = false
                        guard success else {
                            let nsError = error as NSError?
                            // Photos reports its confirmation-sheet cancellation as PHPhotosError.userCancelled.
                            let cancelled = (nsError?.domain == PHPhotosErrorDomain &&
                                nsError?.code == PHPhotosError.Code.userCancelled.rawValue) ||
                                (nsError?.domain == NSCocoaErrorDomain && nsError?.code == NSUserCancelledError)
                            call.reject(cancelled ? "Photo deletion was cancelled." : "Unable to delete the requested photos.",
                                        cancelled ? "CANCELLED" : "DELETE_FAILED", error)
                            return
                        }
                        let remaining = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
                        let currentStatus = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                        guard currentStatus == .authorized || currentStatus == .limited else {
                            call.reject("Photo access was revoked before deletion could be verified.", "PERMISSION_DENIED")
                            return
                        }
                        guard remaining.count == 0 else {
                            call.reject("Photos did not confirm deletion of the entire batch.", "DELETE_FAILED")
                            return
                        }
                        call.resolve(["deletedIds": ids])
                    }
                }
            }
        }
    }

    @objc public func listPhotos(_ call: CAPPluginCall) {
        // No permission request at plugin load or application startup.
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        if status == .notDetermined {
            DispatchQueue.main.async {
                PHPhotoLibrary.requestAuthorization(for: .readWrite) { status in
                    self.listAuthorizedPhotos(call, status: status)
                }
            }
        } else {
            listAuthorizedPhotos(call, status: status)
        }
    }

    private func listAuthorizedPhotos(_ call: CAPPluginCall, status: PHAuthorizationStatus) {
        guard status == .authorized || status == .limited else {
            call.reject("Photo access was denied, restricted, or cancelled. Allow photo access in Settings to continue.", "PERMISSION_DENIED")
            return
        }
        worker.async {
            let options = PHFetchOptions()
            options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
            let assets = PHAsset.fetchAssets(with: .image, options: options)
            let formatter = ISO8601DateFormatter()
            var photos = [[String: Any]]()
            assets.enumerateObjects { asset, _, _ in
                autoreleasepool {
                    let resources = PHAssetResource.assetResources(for: asset)
                    let name = resources.first(where: { $0.type == .photo || $0.type == .fullSizePhoto })?.originalFilename
                        ?? resources.first?.originalFilename ?? "Photo"
                    photos.append(["id": asset.localIdentifier, "name": name,
                                   "createdAt": formatter.string(from: asset.creationDate ?? Date(timeIntervalSince1970: 0))])
                }
            }
            call.resolve(["photos": photos, "limited": status == .limited])
        }
    }

    @objc public func getPhoto(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), !id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            call.reject("A photo id is required.", "INVALID_ID")
            return
        }
        let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
        guard status == .authorized || status == .limited else {
            call.reject("Photo access is not granted. Call listPhotos explicitly to request access.", "PERMISSION_DENIED")
            return
        }
        worker.async {
            autoreleasepool {
                guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject,
                      asset.mediaType == .image else {
                    call.reject("This photo is missing or is no longer accessible.", "PHOTO_NOT_FOUND")
                    return
                }
                let options = PHImageRequestOptions()
                options.isSynchronous = true // Runs on worker, never the main thread.
                options.deliveryMode = .highQualityFormat
                options.resizeMode = .exact
                options.isNetworkAccessAllowed = false // iCloud-only images produce a clear local-access error.
                let target = CGSize(width: Self.maximumDimension, height: Self.maximumDimension)
                self.imageManager.requestImage(for: asset, targetSize: target, contentMode: .aspectFit, options: options) { image, info in
                    if (info?[PHImageCancelledKey] as? Bool) == true {
                        call.reject("Photo loading was cancelled.", "CANCELLED")
                        return
                    }
                    if let error = info?[PHImageErrorKey] as? Error {
                        call.reject("Unable to read this photo: \(error.localizedDescription)", "PHOTO_LOAD_FAILED", error)
                        return
                    }
                    guard let image = image else {
                        call.reject("This photo is not available on this device. Download it in Photos first.", "PHOTO_UNAVAILABLE")
                        return
                    }
                    // Enforce a pixel bound even if Photos returns a larger representation.
                    let ratio = min(1, Self.maximumDimension / max(image.size.width, image.size.height))
                    let size = CGSize(width: max(1, image.size.width * ratio), height: max(1, image.size.height * ratio))
                    let format = UIGraphicsImageRendererFormat()
                    format.scale = 1
                    format.opaque = true
                    let jpeg = UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.8) { context in
                        UIColor.white.setFill()
                        context.fill(CGRect(origin: .zero, size: size))
                        image.draw(in: CGRect(origin: .zero, size: size))
                    }
                    call.resolve(["url": "data:image/jpeg;base64," + jpeg.base64EncodedString()])
                }
            }
        }
    }
}
