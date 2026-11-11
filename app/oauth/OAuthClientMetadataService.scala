package oauth

import com.scalableminds.util.cache.AlfuCache
import com.scalableminds.util.tools.Fox
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsArray, JsObject, JsString, Json}
import utils.WkConf

import java.net.http.{HttpClient, HttpRequest, HttpResponse}
import java.net.{Inet4Address, Inet6Address, InetAddress, URI}
import java.time.Duration
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.DurationInt
import scala.concurrent.{ExecutionContext, Future, blocking}
import scala.jdk.FutureConverters.*
import scala.util.{Try, Using}

/** What WEBKNOSSOS knows about an MCP client.
  *
  * @param isRegistered
  *   true for clients that registered themselves (Dynamic Client Registration). Their name is chosen by whoever
  *   registered them and verified by nothing. A client identified by a metadata document is at least backed by the
  *   domain that hosts the document.
  */
case class OAuthClientMetadata(
    clientId: String,
    clientName: String,
    redirectUris: List[String],
    isRegistered: Boolean = false
)

/** Clients are not registered with WEBKNOSSOS. Instead, a client's id is the https URL of a JSON document describing it
  * (OAuth Client ID Metadata Document, as preferred by MCP since revision 2025-11-25), which is fetched when the client
  * starts an authorization. Whoever controls that URL controls the client, in particular its redirect URIs.
  *
  * Fetching a URL that the request names is a server-side request forgery risk, so only https URLs on public addresses
  * are fetched, without following redirects, with a timeout and a size limit. A remaining gap is DNS rebinding between
  * the address check and the connection, which the JDK HttpClient offers no hook to close; the request carries no
  * credentials and its response is only accepted if it is a valid metadata document, which limits what it could be used
  * for.
  */
@Singleton
class OAuthClientMetadataService @Inject() (conf: WkConf)(implicit ec: ExecutionContext) extends LazyLogging {

  import OAuthClientMetadataService.*

  private val allowInsecure = conf.WebKnossos.Mcp.allowInsecureClientMetadataUrls

  private val cache: AlfuCache[String, OAuthClientMetadata] =
    AlfuCache(maxCapacity = 1000, timeToLive = 10 minutes, timeToIdle = 10 minutes)

  private lazy val httpClient: HttpClient =
    HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(5)).build()

  def fetch(clientId: String): Fox[OAuthClientMetadata] =
    cache.getOrLoad(clientId, load)

  private def load(clientId: String): Fox[OAuthClientMetadata] =
    for {
      uri <- fromEither(validateClientIdUrl(clientId, allowInsecure))
      _ <- Fox.fromFuture(checkAddresses(uri)).flatMap(fromEither)
      body <- Fox.fromFuture(download(uri)).flatMap(fromEither)
      json <- fromEither(Try(Json.parse(body)).toEither.left.map(_ => "The client metadata document is no JSON"))
      metadata <- fromEither(parseDocument(clientId, json, allowInsecure))
    } yield metadata

  private def fromEither[T](either: Either[String, T]): Fox[T] =
    either.fold(message => Fox.failure(message), value => Fox.successful(value))

  private def checkAddresses(uri: URI): Future[Either[String, Unit]] =
    if (allowInsecure) Future.successful(Right(()))
    else
      Future {
        blocking {
          Try(InetAddress.getAllByName(uri.getHost).toList).toEither.left
            .map(_ => s"Could not resolve the host of the client id ${uri.getHost}")
            .flatMap { addresses =>
              if (addresses.nonEmpty && addresses.forall(isPublicAddress)) Right(())
              else Left("The client id must point to a public address")
            }
        }
      }

  private def download(uri: URI): Future[Either[String, Array[Byte]]] = {
    val request =
      HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(5)).header("Accept", "application/json").GET().build()
    httpClient
      .sendAsync(request, HttpResponse.BodyHandlers.ofInputStream())
      .asScala
      .flatMap { response =>
        Future {
          blocking {
            Using.resource(response.body()) { stream =>
              if (response.statusCode() != 200)
                Left(s"Fetching the client metadata document failed with status ${response.statusCode()}")
              else {
                val bytes = stream.readNBytes(maxDocumentBytes + 1)
                if (bytes.length > maxDocumentBytes) Left("The client metadata document is too large")
                else Right(bytes)
              }
            }
          }
        }
      }
      .recover { case e: Exception =>
        logger.info(s"Fetching the client metadata document $uri failed: ${e.getMessage}")
        Left("Could not fetch the client metadata document")
      }
  }
}

object OAuthClientMetadataService {

  // The spec recommends that servers limit the size, 5 kilobytes being the suggested limit.
  private val maxDocumentBytes = 5 * 1024

  // Schemes a redirect URI must never use. Everything else is either https, loopback http (validated separately) or a
  // private-use scheme of a native app, see RFC 8252.
  private val forbiddenRedirectSchemes =
    Set("javascript", "data", "file", "vbscript", "blob", "about", "ftp", "ws", "wss")

  def validateClientIdUrl(clientId: String, allowInsecure: Boolean): Either[String, URI] =
    for {
      uri <- Try(new URI(clientId)).toEither.left.map(_ => "The client id is no valid URL")
      _ <- Either.cond(
        uri.getScheme == "https" || (allowInsecure && uri.getScheme == "http"),
        (),
        "The client id must be an https URL"
      )
      _ <- Either.cond(uri.getHost != null && uri.getRawUserInfo == null, (), "The client id must name a host")
      _ <- Either.cond(uri.getRawFragment == null, (), "The client id must not contain a fragment")
      path = Option(uri.getRawPath).getOrElse("")
      _ <- Either.cond(path.length > 1, (), "The client id must contain a path")
      _ <- Either.cond(
        !path.split('/').exists(segment => segment == "." || segment == ".."),
        (),
        "The client id must not contain dot segments"
      )
    } yield uri

  def isPublicAddress(address: InetAddress): Boolean =
    !(address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
      address.isSiteLocalAddress || address.isMulticastAddress || isCarrierGradeNat(address) ||
      isUniqueLocalIpv6(address) || isIpv4MappedNonPublic(address))

  private def isCarrierGradeNat(address: InetAddress): Boolean = address match {
    case v4: Inet4Address =>
      val bytes = v4.getAddress
      (bytes(0) & 0xff) == 100 && (bytes(1) & 0xc0) == 64 // 100.64.0.0/10
    case _ => false
  }

  private def isUniqueLocalIpv6(address: InetAddress): Boolean = address match {
    case v6: Inet6Address => (v6.getAddress()(0) & 0xfe) == 0xfc // fc00::/7
    case _                => false
  }

  // ::ffff:10.0.0.1 and the like. The JDK usually converts these to Inet4Address already, this is a safety net.
  private def isIpv4MappedNonPublic(address: InetAddress): Boolean = address match {
    case v6: Inet6Address =>
      val bytes = v6.getAddress
      val isMapped = bytes.take(10).forall(_ == 0) && (bytes(10) & 0xff) == 0xff && (bytes(11) & 0xff) == 0xff
      isMapped && !isPublicAddress(InetAddress.getByAddress(bytes.drop(12)))
    case _ => false
  }

  def parseDocument(
      clientId: String,
      json: play.api.libs.json.JsValue,
      allowInsecure: Boolean
  ): Either[String, OAuthClientMetadata] =
    json match {
      case document: JsObject =>
        for {
          _ <- Either.cond(
            (document \ "client_id").asOpt[String].contains(clientId),
            (),
            "The client_id in the client metadata document does not match its URL"
          )
          // Only public clients are supported: there is no client authentication at the token endpoint, PKCE takes
          // its place.
          _ <- Either.cond(
            (document \ "token_endpoint_auth_method").asOpt[String].forall(_ == "none"),
            (),
            "Only clients with token_endpoint_auth_method none are supported"
          )
          _ <- Either.cond(
            (document \ "client_secret").toOption.isEmpty,
            (),
            "A client metadata document must not contain a client secret"
          )
          redirectUris <- (document \ "redirect_uris").toOption match {
            case Some(JsArray(values)) if values.nonEmpty && values.forall(_.isInstanceOf[JsString]) =>
              Right(values.map(_.as[String]).toList)
            case _ => Left("The client metadata document must list its redirect_uris")
          }
          _ <- redirectUris.find(!isAcceptableRedirectUri(_, allowInsecure)) match {
            case Some(invalid) => Left(s"Invalid redirect URI in the client metadata document: $invalid")
            case None          => Right(())
          }
          clientName = (document \ "client_name").asOpt[String].map(_.trim).filter(_.nonEmpty).map(_.take(100))
        } yield OAuthClientMetadata(clientId, clientName.getOrElse(new URI(clientId).getHost), redirectUris)
      case _ => Left("The client metadata document must be a JSON object")
    }

  def isAcceptableRedirectUri(redirectUri: String, allowInsecure: Boolean): Boolean =
    Try(new URI(redirectUri)).toOption.exists { uri =>
      val scheme = Option(uri.getScheme).map(_.toLowerCase)
      uri.getRawFragment == null && (scheme match {
        case None             => false
        case Some("https")    => uri.getHost != null
        case Some("http")     => isLoopback(uri) || (allowInsecure && uri.getHost != null)
        case Some(privateUse) => !forbiddenRedirectSchemes.contains(privateUse)
      })
    }

  private def isLoopback(uri: URI): Boolean =
    Option(uri.getHost).exists(host => Set("localhost", "127.0.0.1", "[::1]", "::1").contains(host.toLowerCase))

  /** Redirect URIs must match exactly, with one exception from RFC 8252 (section 7.3): native apps listening on a
    * loopback interface get a random port, so the port is ignored for http loopback redirect URIs.
    */
  def redirectUriMatches(registered: String, requested: String): Boolean =
    registered == requested || (for {
      registeredUri <- Try(new URI(registered)).toOption
      requestedUri <- Try(new URI(requested)).toOption
      if registeredUri.getScheme == "http" && requestedUri.getScheme == "http"
      if isLoopback(registeredUri) && isLoopback(requestedUri)
    } yield registeredUri.getHost.equalsIgnoreCase(requestedUri.getHost) &&
      registeredUri.getRawPath == requestedUri.getRawPath &&
      registeredUri.getRawQuery == requestedUri.getRawQuery).getOrElse(false)
}
