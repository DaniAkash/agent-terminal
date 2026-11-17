import ExpoModulesCore
import UIKit

/// The name of this device as the system reports it to apps.
public class DeviceNameModule: Module {
  public func definition() -> ModuleDefinition {
    Name("DeviceName")

    Function("get") { () -> String? in
      UIDevice.current.name
    }
  }
}
