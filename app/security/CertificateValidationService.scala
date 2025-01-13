package security

import com.scalableminds.util.cache.SingleValueCache

import java.security.{KeyFactory, PublicKey}
import pdi.jwt.JwtJson

import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import scala.concurrent.duration.DurationInt
import scala.util.Properties
class CertificateValidationService {

  private lazy val publicKeyBase64Opt: Option[String] = webknossos.BuildInfo.toMap.get("certificatePublicKey").collect {
    case value: String => value
  }

  private lazy val cache = new SingleValueCache[Boolean](1.minute)

  private def deserializePublicKey(pem: String): PublicKey = {
    val base64Key = pem.replaceAll("\\s", "")
    val decodedKey = Base64.getDecoder.decode(base64Key)
    val keySpec = new X509EncodedKeySpec(decodedKey)
    KeyFactory.getInstance("EC").generatePublic(keySpec)
  }

  private def _checkCertificate(): Boolean = publicKeyBase64Opt.forall { publicKeyBase64 =>
    if (publicKeyBase64.isEmpty) {
      true
    } else {
      val publicKey = deserializePublicKey(publicKeyBase64)
      val currentTimeInSec = System.currentTimeMillis() / 1000
      (for {
        certificate <- Properties.envOrNone("CERTIFICATE_PUBLIC_KEY")
        decodedCertificate <- JwtJson.decodeJson(certificate, publicKey).toOption
        issuedTill <- (decodedCertificate \ "exp").asOpt[Long]
      } yield currentTimeInSec < issuedTill).getOrElse(false)
    }
  }
  def checkCertificate(): Boolean = cache.cachedMethod(_checkCertificate())

}
