package security

import com.scalableminds.util.box.{Box, Empty, Failure, Full}
import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging

import java.security.{KeyFactory, PublicKey}
import pdi.jwt.{JwtJson, JwtOptions}

import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.util.Properties

class CertificateValidationService @Inject() (implicit ec: ExecutionContext) extends LazyLogging {

  // The publicKeyBox is empty if no public key is provided, Failure if decoding the public key failed or Full if there is a valid public key.
  private lazy val publicKeyBox: Box[PublicKey] = webknossos.BuildInfo.certificatePublicKey match {
    case Some(value) => deserializePublicKey(value)
    case None        => Empty
  }

  private lazy val cache: AlfuCache[String, (Boolean, Long)] = AlfuCache(timeToLive = 1 hour)

  private def deserializePublicKey(pem: String): Box[PublicKey] =
    try {
      val base64Key = pem.replaceAll("\\s", "")
      val decodedKey = Base64.getDecoder.decode(base64Key)
      val keySpec = new X509EncodedKeySpec(decodedKey)
      Full(KeyFactory.getInstance("EC").generatePublic(keySpec))
    } catch {
      case _: Throwable =>
        val message = s"Could not deserialize public key from PEM string: $pem"
        logger.error(message)
        Failure(message)
    }

  private case class Certificate(expirationInSeconds: Long, featureOverrides: Map[String, Boolean]) {
    def isExpired: Boolean = System.currentTimeMillis() / 1000 >= expirationInSeconds
  }

  // None if no certificate is provided or its signature cannot be verified with the public key.
  private def decodeCertificate(publicKey: PublicKey): Option[Certificate] =
    for {
      certificate <- Properties.envOrNone("CERTIFICATE")
      // JwtJson would throw an error in case the exp time of the token is expired. As we want to check the expiration
      // date ourselves, we don't want to throw an error.
      token <- JwtJson.decodeJson(certificate, publicKey, JwtOptions(expiration = false)).toOption
      expirationInSeconds <- (token \ "exp").asOpt[Long]
      featureOverrides = (token \ "webknossos").asOpt[Map[String, Boolean]].getOrElse(Map.empty)
    } yield Certificate(expirationInSeconds, featureOverrides)

  private def checkCertificate: (Boolean, Long) = publicKeyBox match {
    case Full(publicKey) =>
      decodeCertificate(publicKey) match {
        case Some(certificate) => (!certificate.isExpired, certificate.expirationInSeconds)
        case None              => (false, 0L)
      }
    case Empty => (true, 0L) // No public key provided, so expiration is not enforced.
    case _     => (false, 0L) // Invalid public key provided, so certificate is always invalid.
  }

  def checkCertificateCached(): Fox[(Boolean, Long)] = cache.getOrLoad("c", _ => Fox.successful(checkCertificate))

  private def paidFeaturesDisabled: Map[String, Boolean] =
    Map("openIdConnectEnabled" -> false, "segmentAnythingEnabled" -> false, "editableMappingsEnabled" -> false)

  // Paid features are disabled unless a valid, non-expired certificate enables them.
  // The overrides are combined with the config values via AND (see WkConf), so the config can still disable features.
  // Evaluated once at startup. Expiry at runtime is handled by the frontend via checkCertificate.
  lazy val getFeatureOverrides: Map[String, Boolean] = publicKeyBox match {
    case Full(publicKey) =>
      decodeCertificate(publicKey).filterNot(_.isExpired) match {
        case Some(certificate) => paidFeaturesDisabled ++ certificate.featureOverrides
        case None              => paidFeaturesDisabled
      }
    case _ => paidFeaturesDisabled
  }
}
