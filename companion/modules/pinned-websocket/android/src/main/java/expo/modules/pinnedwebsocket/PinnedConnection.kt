package expo.modules.pinnedwebsocket

import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

internal class PinnedConnection(
  private val id: String,
  private val emit: (String, Map<String, Any?>) -> Unit,
  private val terminate: (String) -> Unit,
) : WebSocketListener() {
  var socket: WebSocket? = null

  // Idempotent terminal-path guard so multiple close/failure racing on
  // the OkHttp dispatcher can't double-remove or double-emit.
  private val terminated = AtomicBoolean(false)

  override fun onOpen(webSocket: WebSocket, response: Response) {
    emit("onOpen", mapOf("id" to id))
  }

  override fun onMessage(webSocket: WebSocket, text: String) {
    emit("onMessage", mapOf("id" to id, "data" to text))
  }

  override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
    // Wire protocol is JSON text; if a binary frame ever arrives, best-effort
    // decode as UTF-8 rather than dropping it silently.
    emit("onMessage", mapOf("id" to id, "data" to bytes.utf8()))
  }

  override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
    emit("onClose", mapOf("id" to id, "code" to code, "reason" to reason))
    teardown()
  }

  override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
    emit(
      "onError",
      mapOf("id" to id, "message" to (t.message ?: t.javaClass.simpleName)),
    )
    teardown()
  }

  private fun teardown() {
    if (!terminated.compareAndSet(false, true)) return
    terminate(id)
  }
}
