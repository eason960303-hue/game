import Flutter
import GoogleMaps
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    if let apiKey = googleMapsApiKey() {
      GMSServices.provideAPIKey(apiKey)
    }
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  /// Reads the key passed with flutter run --dart-define=GOOGLE_MAPS_API_KEY=...
  private func googleMapsApiKey() -> String? {
    let prefix = "GOOGLE_MAPS_API_KEY="
    let defines = Bundle.main.object(forInfoDictionaryKey: "DartDefines") as? String ?? ""
    return defines.split(separator: ",")
      .compactMap { Data(base64Encoded: String($0)) }
      .compactMap { String(data: $0, encoding: .utf8) }
      .first { $0.hasPrefix(prefix) && $0.count > prefix.count }
      .map { String($0.dropFirst(prefix.count)) }
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
  }
}
