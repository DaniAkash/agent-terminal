import ExpoModulesCore

public class PinnedWebSocketModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PinnedWebSocket")

    Events("onChange")

    Function("hello") {
      return "Hello world! 👋"
    }

    AsyncFunction("setValueAsync") { (value: String) in
      self.sendEvent("onChange", [
        "value": value
      ])
    }
  }
}
