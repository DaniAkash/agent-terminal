package expo.modules.pinnedwebsocket

import java.security.MessageDigest
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.X509TrustManager

/**
 * Trusts a server iff the leaf cert's SHA-256 (of DER bytes) matches
 * [expectedFingerprint], formatted as uppercase colon-separated hex.
 *
 * OkHttp's built-in CertificatePinner cannot be used here for two reasons:
 * (1) it runs after default chain validation, which rejects self-signed
 * LAN certs before pinning gets a chance; (2) it hashes the SPKI and
 * expects `sha256/<base64>`, which does not match the DER-full-cert
 * fingerprint the desktop emits and the QR carries.
 */
internal class PinningTrustManager(
  private val expectedFingerprint: String,
) : X509TrustManager {
  override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    throw CertificateException("client authentication is not supported")
  }

  override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
    val leaf = chain?.firstOrNull()
      ?: throw CertificateException("empty server cert chain")
    val digest = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
    val observed = digest.joinToString(":") { "%02X".format(it) }
    if (observed != expectedFingerprint) {
      throw CertificateException(
        "certificate pinning failed: presented $observed, expected $expectedFingerprint",
      )
    }
  }

  override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}
