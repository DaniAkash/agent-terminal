package expo.modules.pinnedwebsocket

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.SSLContext
import okhttp3.OkHttpClient
import okhttp3.Request

class PinnedWebSocketModule : Module() {
  private val connections = ConcurrentHashMap<String, PinnedConnection>()

  override fun definition() = ModuleDefinition {
    Name("PinnedWebSocket")

    Events("onOpen", "onMessage", "onClose", "onError")

    AsyncFunction("connect") { url: String, fingerprint: String, promise: Promise ->
      if (!url.startsWith("wss://")) {
        promise.reject(
          "E_SCHEME",
          "PinnedWebSocket only accepts wss:// URLs, got $url",
          null,
        )
        return@AsyncFunction
      }
      val id = UUID.randomUUID().toString()
      val trustManager = PinningTrustManager(normalizeFingerprint(fingerprint))
      val sslContext = SSLContext.getInstance("TLS").apply {
        init(null, arrayOf(trustManager), SecureRandom())
      }
      val client = OkHttpClient.Builder()
        .sslSocketFactory(sslContext.socketFactory, trustManager)
        // Identity is proven byte-for-byte by the SHA-256 pin. A hostname
        // mismatch (e.g. connecting to a LAN IP whose cert has a .local SAN)
        // would only produce spurious rejections.
        .hostnameVerifier { _, _ -> true }
        .build()
      val request = Request.Builder().url(url).build()
      // `terminate` runs from onClosed / onFailure on the OkHttp
      // dispatcher thread. Idempotence lives inside PinnedConnection
      // so the map removal here happens at most once per connection.
      val connection = PinnedConnection(
        id,
        emit = { name, body -> sendEvent(name, body) },
        terminate = { closedId -> connections.remove(closedId) },
      )
      connection.socket = client.newWebSocket(request, connection)
      connections[id] = connection
      promise.resolve(id)
    }

    Function("send") { id: String, text: String ->
      connections[id]?.socket?.send(text)
    }

    AsyncFunction("close") { id: String, code: Int?, reason: String? ->
      val connection = connections.remove(id) ?: return@AsyncFunction
      connection.socket?.close(code ?: 1000, reason)
    }
  }

  private fun normalizeFingerprint(raw: String): String =
    raw.uppercase().trim()
}
