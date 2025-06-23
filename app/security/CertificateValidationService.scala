package security

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import com.scalableminds.util.tools.{Box, Empty, Failure, Full}

import java.security.{KeyFactory, PublicKey}
import pdi.jwt.{JwtJson, JwtOptions}

import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.util.Properties

class CertificateValidationService @Inject()(implicit ec: ExecutionContext) extends LazyLogging {

  // The publicKeyBox is empty if no public key is provided, Failure if decoding the public key failed or Full if there is a valid public key.
  private lazy val publicKeyBox: Box[PublicKey] = Box(webknossos.BuildInfo.toMap.get("certificatePublicKey")).flatMap {
    case Some(value: String) => deserializePublicKey(value)
    case None                => Empty
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

  private def checkCertificate: (Boolean, Long) = publicKeyBox match {
    case Full(publicKey) =>
      (for {
        certificate <- Properties.envOrNone("CERTIFICATE")
        // JwtJson would throw an error in case the exp time of the token is expired. As we want to check the expiration
        // date yourself, we don't want to throw an error.
        token <- JwtJson.decodeJson(certificate, publicKey, JwtOptions(expiration = false)).toOption
        expirationInSeconds <- (token \ "exp").asOpt[Long]
        currentTimeInSeconds = System.currentTimeMillis() / 1000
        isExpired = currentTimeInSeconds < expirationInSeconds
      } yield (isExpired, expirationInSeconds)).getOrElse((false, 0L))
    case Empty => (true, 0L) // No public key provided, so certificate is always valid.
    case _     => (false, 0L) // Invalid public key provided, so certificate is always invalid.
  }

  def checkCertificateCached(): Fox[(Boolean, Long)] = cache.getOrLoad("c", _ => Fox.successful(checkCertificate))

  private def defaultConfigOverridesMap: Map[String, Boolean] =
    Map("openIdConnectEnabled" -> false, "segmentAnythingEnabled" -> false, "editableMappingsEnabled" -> false)

  lazy val getFeatureOverrides: Map[String, Boolean] = publicKeyBox match {
    case Full(publicKey) =>
      (for {
        certificate <- Properties.envOrNone("CERTIFICATE")
        // JwtJson already throws an error which is transformed to an empty option when the certificate is expired.
        // In case the token is expired, tge default map will be used.
        token <- JwtJson.decodeJson(certificate, publicKey, JwtOptions(expiration = false)).toOption
        featureOverrides <- Some(
          (token \ "webknossos").asOpt[Map[String, Boolean]].getOrElse(defaultConfigOverridesMap))
        featureOverridesWithDefaults = featureOverrides ++ defaultConfigOverridesMap.view.filterKeys(
          !featureOverrides.contains(_))
      } yield featureOverridesWithDefaults).getOrElse(defaultConfigOverridesMap)
    case Empty => Map.empty
    case _     => defaultConfigOverridesMap
  }
}
