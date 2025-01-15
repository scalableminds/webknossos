package security

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import net.liftweb.common.{Box, Empty, Failure, Full}

import java.security.{KeyFactory, PublicKey}
import pdi.jwt.JwtJson

import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import javax.inject.Inject
import scala.concurrent.ExecutionContext
import scala.concurrent.duration.DurationInt
import scala.util.Properties

class CertificateValidationService @Inject()(implicit ec: ExecutionContext) extends LazyLogging {

  // The publicKeyBox is empty if no public key is provided, Failure if decoding the public key failed or Full if there is a valid public key.
  private lazy val publicKeyBox: Box[PublicKey] = webknossos.BuildInfo.toMap.get("certificatePublicKey").flatMap {
    case Some(value: String) => deserializePublicKey(value)
    case None                => Empty
  }

  private lazy val cache: AlfuCache[String, Boolean] = AlfuCache(timeToLive = 1 minute)

  private def deserializePublicKey(pem: String): Box[PublicKey] =
    try {
      val base64Key = pem.replaceAll("\\s", "")
      val decodedKey = Base64.getDecoder.decode(base64Key)
      val keySpec = new X509EncodedKeySpec(decodedKey)
      Some(KeyFactory.getInstance("EC").generatePublic(keySpec))
    } catch {
      case _: Throwable =>
        val message = s"Could not deserialize public key from PEM string: $pem"
        logger.error(message)
        Failure(message)
    }

  private def _checkCertificate(): Boolean = publicKeyBox match {
    case Full(publicKey) =>
      (for {
        certificate <- Properties.envOrNone("CERTIFICATE")
        // JwtJson already throws and error which is transformed to an empty option when the certificate is expired.
        _ <- JwtJson.decodeJson(certificate, publicKey).toOption
      } yield true).getOrElse(false)
    case Empty => true
    case _     => false
  }

  def checkCertificate(): Fox[Boolean] = cache.getOrLoad("c", _ => Fox.successful(_checkCertificate()))

  private def defaultMap: Map[String, Boolean] = Map("sso" -> false, "sam" -> false, "proofreading" -> false)

  lazy val getFeatureOverwrites: Map[String, Boolean] = publicKeyBox match {
    case Full(publicKey) =>
      (for {
        certificate <- Properties.envOrNone("CERTIFICATE")
        // JwtJson already throws and error which is transformed to an empty option when the certificate is expired.
        token <- JwtJson.decodeJson(certificate, publicKey).toOption
        featureOverwrites <- Some((token \ "features").asOpt[Map[String, Boolean]].getOrElse(defaultMap))
        featureOverwritesWithDefaults = featureOverwrites ++ defaultMap.view.filterKeys(!featureOverwrites.contains(_))
      } yield featureOverwritesWithDefaults).getOrElse(defaultMap)
    case Empty => Map.empty
    case _     => defaultMap
  }
}
