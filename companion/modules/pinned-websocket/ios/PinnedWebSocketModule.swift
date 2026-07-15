import CryptoKit
import ExpoModulesCore
import Foundation

public class PinnedWebSocketModule: Module {
  private let registry = ConnectionRegistry()

  public func definition() -> ModuleDefinition {
    Name("PinnedWebSocket")

    Events("onOpen", "onMessage", "onClose", "onError")

    AsyncFunction("connect") { (url: String, fingerprint: String, promise: Promise) in
      guard url.hasPrefix("wss://") else {
        promise.reject("E_SCHEME", "PinnedWebSocket only accepts wss:// URLs, got \(url)")
        return
      }
      guard let parsed = URL(string: url) else {
        promise.reject("E_URL", "PinnedWebSocket got an unparseable URL: \(url)")
        return
      }
      let id = UUID().uuidString
      let connection = PinnedConnection(
        id: id,
        expectedFingerprint: normalizeFingerprint(fingerprint),
        emit: { [weak self] name, body in self?.sendEvent(name, body) }
      )
      self.registry.insert(id: id, connection: connection)
      connection.open(url: parsed)
      promise.resolve(id)
    }

    Function("send") { (id: String, text: String) in
      self.registry.get(id: id)?.send(text: text)
    }

    AsyncFunction("close") { (id: String, code: Int?, reason: String?) in
      guard let connection = self.registry.remove(id: id) else { return }
      connection.close(code: code, reason: reason)
    }
  }
}

private final class ConnectionRegistry {
  private var connections: [String: PinnedConnection] = [:]
  private let lock = NSLock()

  func insert(id: String, connection: PinnedConnection) {
    lock.lock(); defer { lock.unlock() }
    connections[id] = connection
  }

  func get(id: String) -> PinnedConnection? {
    lock.lock(); defer { lock.unlock() }
    return connections[id]
  }

  func remove(id: String) -> PinnedConnection? {
    lock.lock(); defer { lock.unlock() }
    return connections.removeValue(forKey: id)
  }
}

private final class PinnedConnection: NSObject, URLSessionDelegate, URLSessionWebSocketDelegate {
  let id: String
  let expectedFingerprint: String
  private let emit: (String, [String: Any?]) -> Void
  private var session: URLSession!
  private var task: URLSessionWebSocketTask?

  init(
    id: String,
    expectedFingerprint: String,
    emit: @escaping (String, [String: Any?]) -> Void
  ) {
    self.id = id
    self.expectedFingerprint = expectedFingerprint
    self.emit = emit
    super.init()
    // Ephemeral: no persisted cookies, credentials, or URL cache. We do not
    // want URLSession reusing a cached credential from a previous run.
    self.session = URLSession(
      configuration: .ephemeral,
      delegate: self,
      delegateQueue: nil
    )
  }

  func open(url: URL) {
    let task = session.webSocketTask(with: url)
    self.task = task
    task.resume()
    pump()
  }

  func send(text: String) {
    guard let task else { return }
    task.send(.string(text)) { [weak self] error in
      guard let self, let error else { return }
      self.emit("onError", ["id": self.id, "message": error.localizedDescription])
    }
  }

  func close(code: Int?, reason: String?) {
    let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code ?? 1000) ?? .normalClosure
    task?.cancel(with: closeCode, reason: reason?.data(using: .utf8))
    // Breaks the session -> delegate retain cycle once outstanding tasks drain.
    session.finishTasksAndInvalidate()
  }

  // Recursively re-arm receive; each call yields exactly one message.
  private func pump() {
    task?.receive { [weak self] result in
      guard let self else { return }
      switch result {
      case .success(let message):
        switch message {
        case .string(let text):
          self.emit("onMessage", ["id": self.id, "data": text])
        case .data(let data):
          let text = String(data: data, encoding: .utf8) ?? ""
          self.emit("onMessage", ["id": self.id, "data": text])
        @unknown default:
          break
        }
        self.pump()
      case .failure(let error):
        self.emit("onError", ["id": self.id, "message": error.localizedDescription])
      }
    }
  }

  func urlSession(
    _ session: URLSession,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    guard
      challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
      let trust = challenge.protectionSpace.serverTrust,
      let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
      let leaf = chain.first
    else {
      completionHandler(.cancelAuthenticationChallenge, nil)
      return
    }
    // Pin the whole DER cert (not the SPKI). Matches the desktop's
    // `openssl x509 -fingerprint -sha256` format that the QR carries, and
    // matches the Android trust manager's hash byte-for-byte.
    let der = SecCertificateCopyData(leaf) as Data
    let observed = hexColon(digest: SHA256.hash(data: der))
    if observed == expectedFingerprint {
      completionHandler(.useCredential, URLCredential(trust: trust))
    } else {
      emit("onError", [
        "id": id,
        "message":
          "certificate pinning failed: presented \(observed), expected \(expectedFingerprint)",
      ])
      completionHandler(.cancelAuthenticationChallenge, nil)
    }
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didOpenWithProtocol protocol: String?
  ) {
    emit("onOpen", ["id": id])
  }

  func urlSession(
    _ session: URLSession,
    webSocketTask: URLSessionWebSocketTask,
    didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
    reason: Data?
  ) {
    let reasonText = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
    emit("onClose", [
      "id": id,
      "code": closeCode.rawValue,
      "reason": reasonText,
    ])
  }
}

private func hexColon<D: Sequence>(digest: D) -> String where D.Element == UInt8 {
  digest.map { String(format: "%02X", $0) }.joined(separator: ":")
}

private func normalizeFingerprint(_ raw: String) -> String {
  raw.uppercased().trimmingCharacters(in: .whitespacesAndNewlines)
}
