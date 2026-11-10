package oauth

import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.box.{Empty, Failure, Full}
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.toFox
import com.typesafe.scalalogging.LazyLogging
import models.user.{User, UserService}
import org.apache.http.client.utils.URIBuilder
import play.api.libs.json.{JsArray, JsObject, JsString, JsValue, Json}
import security.{RandomIDGenerator, ScopeMode, ShortLivedTokenService}
import utils.WkConf

import java.net.URI
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.Base64
import javax.inject.{Inject, Singleton}
import scala.concurrent.duration.{DurationInt, FiniteDuration}
import scala.concurrent.{ExecutionContext, Future}

/** An authorization request as sent by an MCP client to the authorization endpoint, after validation. */
case class ValidatedAuthorizationRequest(
    client: OAuthClientMetadata,
    redirectUri: String,
    state: Option[String],
    codeChallenge: String,
    requestedLevel: ScopeMode.Value
)

/** A failed authorization request. If the client and its redirect URI could be verified, the client is to be told via
  * redirectUrl. Otherwise the error must only be shown to the user, redirecting would send them to an unverified URL.
  */
case class AuthorizationError(message: String, redirectUrl: Option[String])

/** An error of the token endpoint (RFC 6749 section 5.2) or of the registration endpoint (RFC 7591 section 3.2.2). */
case class OAuthEndpointError(error: String, description: String) {
  def toJson: JsObject = Json.obj("error" -> error, "error_description" -> description)
}

/** WEBKNOSSOS as an OAuth 2.1 authorization server for its MCP server, as the MCP authorization spec asks for.
  *
  *   - Clients are identified either by a client metadata document (see OAuthClientMetadataService), or register
  *     themselves via Dynamic Client Registration (RFC 7591), which anyone may do. The consent page tells the user that
  *     the name of a registered client is unverified.
  *   - Only the authorization code flow with PKCE (S256) is supported, plus refresh tokens. Clients are public, they do
  *     not authenticate at the token endpoint.
  *   - The user approves a permission level on the consent page (frontend route /oauth/authorize). Approving creates or
  *     updates an OAuthGrant, which everything issued afterwards hangs off and is revoked with.
  *   - Access tokens are only accepted by the MCP endpoint (McpController). Agents get separate short-lived tokens for
  *     the rest of the API via the MCP server, limited to the grant's scopes.
  *   - Refresh tokens are rotated. Presenting a used refresh token or authorization code again revokes the grant, since
  *     it means that the token has leaked.
  */
@Singleton
class OAuthService @Inject() (
    conf: WkConf,
    clientMetadataService: OAuthClientMetadataService,
    clientDAO: OAuthClientDAO,
    grantDAO: OAuthGrantDAO,
    codeDAO: OAuthAuthorizationCodeDAO,
    tokenDAO: OAuthTokenDAO,
    shortLivedTokenService: ShortLivedTokenService,
    userService: UserService
)(implicit ec: ExecutionContext)
    extends LazyLogging {

  import OAuthService.*

  val issuer: String = conf.Http.uri.stripSuffix("/")
  val authorizationEndpoint: String = s"$issuer/oauth/authorize"
  val tokenEndpoint: String = s"$issuer/api/oauth/token"
  val registrationEndpoint: String = s"$issuer/api/oauth/register"
  // The MCP endpoint is the only resource that access tokens are issued for.
  val mcpResource: String = s"$issuer/api/mcp"
  val protectedResourceMetadataUrl: String = s"$issuer/.well-known/oauth-protected-resource/api/mcp"

  // As browsers send it in the Origin header: scheme, host and port, the latter only if it is not the scheme's default.
  val instanceOrigin: String = {
    val uri = new URI(issuer)
    val isDefaultPort = uri.getPort == -1 || (uri.getScheme, uri.getPort) == ("http", 80) ||
      (uri.getScheme, uri.getPort) == ("https", 443)
    s"${uri.getScheme}://${uri.getHost}${if (isDefaultPort) "" else s":${uri.getPort}"}"
  }

  private val authorizationCodeExpiry: FiniteDuration = 2.minutes
  private val accessTokenExpiry: FiniteDuration = 1.hour
  // Each refresh issues a new refresh token, so this is the time a connection may stay unused.
  private val refreshTokenExpiry: FiniteDuration = 30.days
  // Registered clients that did not get a grant within this time are deleted.
  private val unusedClientExpiry: FiniteDuration = 1.day

  /* ---------- Authorization endpoint (consent page) ---------- */

  def validateAuthorizationRequest(
      params: Map[String, String]
  ): Future[Either[AuthorizationError, ValidatedAuthorizationRequest]] =
    params.get("client_id") match {
      case None           => Future.successful(Left(AuthorizationError("The request names no client_id", None)))
      case Some(clientId) =>
        resolveClient(clientId).futureBox.map {
          case Full(client) =>
            params.get("redirect_uri") match {
              case None => Left(AuthorizationError("The request names no redirect_uri", None))
              case Some(redirectUri) if !client.redirectUris.exists(redirectUriMatches(_, redirectUri)) =>
                Left(AuthorizationError("The redirect_uri is not one of the client's redirect URIs", None))
              case Some(redirectUri) =>
                // From here on, errors go back to the client.
                val state = params.get("state")
                def fail(error: String, description: String) =
                  Left(AuthorizationError(description, Some(errorRedirect(redirectUri, state, error, description))))
                if (!params.get("response_type").contains("code"))
                  fail(
                    "unsupported_response_type",
                    "Only the authorization code flow (response_type=code) is supported"
                  )
                else if (!params.get("code_challenge_method").contains("S256"))
                  fail("invalid_request", "PKCE with code_challenge_method S256 is required")
                else if (!params.get("code_challenge").exists(isValidCodeChallenge))
                  fail("invalid_request", "Missing or invalid code_challenge")
                else if (!params.get("resource").forall(isMcpResource))
                  fail("invalid_target", s"The only resource on this server is $mcpResource")
                else
                  Right(
                    ValidatedAuthorizationRequest(
                      client,
                      redirectUri,
                      state,
                      params("code_challenge"),
                      levelFromScope(params.get("scope"))
                    )
                  )
            }
          case failure: Failure => Left(AuthorizationError(s"Unknown client: ${failure.msg}", None))
          case Empty            => Left(AuthorizationError("Unknown client", None))
        }
    }

  /** A client id is either the URL of a client metadata document, or the id of a client that registered itself. */
  private def resolveClient(clientId: String): Fox[OAuthClientMetadata] =
    if (clientId.startsWith("https://") || clientId.startsWith("http://")) clientMetadataService.fetch(clientId)
    else clientDAO.findOne(clientId)

  /* ---------- Registration endpoint (RFC 7591) ---------- */

  def registerClient(request: JsValue): Fox[Either[OAuthEndpointError, JsObject]] =
    parseRegistrationRequest(request, conf.WebKnossos.Mcp.allowInsecureClientMetadataUrls) match {
      case Left(error)                       => Fox.successful(Left(error))
      case Right((clientName, redirectUris)) =>
        val client = OAuthClientMetadata(
          registeredClientPrefix + RandomIDGenerator.generateBlocking(sizeInBytes = 16),
          clientName,
          redirectUris,
          isRegistered = true
        )
        for {
          _ <- clientDAO.insertOne(client)
        } yield Right(
          Json.obj(
            "client_id" -> client.clientId,
            "client_id_issued_at" -> Instant.now.epochMillis / 1000,
            "client_name" -> client.clientName,
            "redirect_uris" -> client.redirectUris,
            "grant_types" -> Json.arr("authorization_code", "refresh_token"),
            "response_types" -> Json.arr("code"),
            // Clients are public whatever they asked for. They get no secret, PKCE takes its place.
            "token_endpoint_auth_method" -> "none"
          )
        )
    }

  /** The user approved: create or update the grant and return the redirect to the client, carrying the code. */
  def approve(user: User, request: ValidatedAuthorizationRequest, level: ScopeMode.Value): Fox[String] =
    for {
      grant <- upsertGrant(user, request.client, level)
      code = randomSecret()
      _ <- codeDAO.insertOne(
        hash(code),
        OAuthAuthorizationCode(grant._id, request.redirectUri, request.codeChallenge),
        Instant.now + authorizationCodeExpiry
      )
    } yield redirectWith(request.redirectUri, request.state, "code" -> code)

  def denyRedirect(request: ValidatedAuthorizationRequest): String =
    errorRedirect(request.redirectUri, request.state, "access_denied", "The user denied the request")

  private def upsertGrant(user: User, client: OAuthClientMetadata, level: ScopeMode.Value): Fox[OAuthGrant] =
    grantDAO.findLiveByUserAndClient(user._id, client.clientId).shiftBox.flatMap {
      case Full(existing) =>
        for {
          _ <- grantDAO.updateScopesAndClientName(existing._id, level.toString, client.clientName)
        } yield existing.copy(scopes = level.toString, clientName = client.clientName)
      case Empty =>
        val grant = OAuthGrant(ObjectId.generate, user._id, client.clientId, client.clientName, level.toString)
        grantDAO.insertOne(grant).map(_ => grant)
      case failure: Failure => failure.toFox
    }

  private def redirectWith(redirectUri: String, state: Option[String], params: (String, String)*): String = {
    val builder = new URIBuilder(redirectUri)
    params.foreach { case (key, value) => builder.addParameter(key, value) }
    state.foreach(builder.addParameter("state", _))
    // RFC 9207, lets the client check that the response comes from the server it talked to.
    builder.addParameter("iss", issuer)
    builder.build().toString
  }

  private def errorRedirect(redirectUri: String, state: Option[String], error: String, description: String): String =
    redirectWith(redirectUri, state, "error" -> error, "error_description" -> description)

  private def isMcpResource(resource: String): Boolean =
    resource.stripSuffix("/") == mcpResource

  /* ---------- Token endpoint ---------- */

  def handleTokenRequest(params: Map[String, String]): Fox[Either[OAuthEndpointError, JsObject]] =
    if (!params.get("resource").forall(isMcpResource))
      Fox.successful(Left(OAuthEndpointError("invalid_target", s"The only resource on this server is $mcpResource")))
    else
      params.get("grant_type") match {
        case Some("authorization_code") => exchangeCode(params)
        case Some("refresh_token")      => refresh(params)
        case _                          =>
          Fox.successful(
            Left(OAuthEndpointError("unsupported_grant_type", "Supported are authorization_code and refresh_token"))
          )
      }

  private def invalidGrant(description: String): Either[OAuthEndpointError, JsObject] =
    Left(OAuthEndpointError("invalid_grant", description))

  private def exchangeCode(params: Map[String, String]): Fox[Either[OAuthEndpointError, JsObject]] =
    (params.get("code"), params.get("client_id"), params.get("redirect_uri"), params.get("code_verifier")) match {
      case (Some(code), Some(clientId), Some(redirectUri), Some(codeVerifier)) =>
        val codeHash = hash(code)
        codeDAO.redeem(codeHash).shiftBox.flatMap {
          case Full(redeemed) =>
            withLiveGrant(redeemed.grantId) { grant =>
              if (grant.clientId != clientId) Fox.successful(invalidGrant("The code was issued to another client"))
              else if (redeemed.redirectUri != redirectUri)
                Fox.successful(invalidGrant("The redirect_uri does not match"))
              else if (!pkceMatches(codeVerifier, redeemed.codeChallenge))
                Fox.successful(invalidGrant("The code_verifier does not match the code_challenge"))
              else issueTokens(grant).map(Right(_))
            }
          case Empty =>
            // A code that was redeemed before has leaked, so everything issued under its grant is revoked.
            codeDAO.findGrantOfUsedCode(codeHash).shiftBox.flatMap {
              case Full(grantId) =>
                logger.warn(s"OAuth authorization code of grant $grantId was used twice, revoking the grant.")
                revokeGrant(grantId).map(_ => invalidGrant("The code was used before"))
              case _ => Fox.successful(invalidGrant("The code is invalid or expired"))
            }
          case failure: Failure => failure.toFox
        }
      case _ =>
        Fox.successful(
          Left(OAuthEndpointError("invalid_request", "Required are code, client_id, redirect_uri and code_verifier"))
        )
    }

  private def refresh(params: Map[String, String]): Fox[Either[OAuthEndpointError, JsObject]] =
    (params.get("refresh_token"), params.get("client_id")) match {
      case (Some(refreshToken), Some(clientId)) =>
        val tokenHash = hash(refreshToken)
        tokenDAO.redeemRefreshToken(tokenHash).shiftBox.flatMap {
          case Full(grantId) =>
            withLiveGrant(grantId) { grant =>
              if (grant.clientId != clientId) Fox.successful(invalidGrant("The token was issued to another client"))
              else issueTokens(grant).map(Right(_))
            }
          case Empty =>
            tokenDAO.findGrantOfUsedRefreshToken(tokenHash).shiftBox.flatMap {
              case Full(grantId) =>
                logger.warn(s"OAuth refresh token of grant $grantId was used twice, revoking the grant.")
                revokeGrant(grantId).map(_ => invalidGrant("The refresh token was used before"))
              case _ => Fox.successful(invalidGrant("The refresh token is invalid or expired"))
            }
          case failure: Failure => failure.toFox
        }
      case _ =>
        Fox.successful(Left(OAuthEndpointError("invalid_request", "Required are refresh_token and client_id")))
    }

  // The grant must still exist and its user must still be active.
  private def withLiveGrant(grantId: ObjectId)(
      f: OAuthGrant => Fox[Either[OAuthEndpointError, JsObject]]
  ): Fox[Either[OAuthEndpointError, JsObject]] =
    (for {
      grant <- grantDAO.findLive(grantId)
      user <- userService.findOneCached(grant._user)(using GlobalAccessContext)
      _ <- Fox.fromBool(!user.isDeactivated)
    } yield grant).shiftBox.flatMap {
      case Full(grant)      => f(grant)
      case Empty            => Fox.successful(invalidGrant("The authorization has been revoked"))
      case failure: Failure => failure.toFox
    }

  private def issueTokens(grant: OAuthGrant): Fox[JsObject] = {
    val accessToken = accessTokenPrefix + randomSecret()
    val refreshToken = refreshTokenPrefix + randomSecret()
    val now = Instant.now
    for {
      _ <- tokenDAO.insertOne(hash(accessToken), grant._id, OAuthTokenType.Access, now + accessTokenExpiry)
      _ <- tokenDAO.insertOne(hash(refreshToken), grant._id, OAuthTokenType.Refresh, now + refreshTokenExpiry)
    } yield Json.obj(
      "access_token" -> accessToken,
      "token_type" -> "Bearer",
      "expires_in" -> accessTokenExpiry.toSeconds,
      "refresh_token" -> refreshToken,
      "scope" -> grant.scopes
    )
  }

  /* ---------- Resource server (MCP endpoint) ---------- */

  /** The user and grant an access token stands for. Empty if the token is unknown, expired or revoked, or if its user
    * has been deactivated. Failure if the lookup itself failed.
    */
  def authenticateAccessToken(accessToken: String): Fox[(User, OAuthGrant)] =
    if (!accessToken.startsWith(accessTokenPrefix)) Fox.empty
    else
      for {
        grantId <- tokenDAO.findGrantOfAccessToken(hash(accessToken))
        grant <- grantDAO.findLive(grantId)
        user <- userService.findOneCached(grant._user)(using GlobalAccessContext)
        _ <- Fox.fromBool(!user.isDeactivated)
        _ = grantDAO.touch(grant._id) // not awaited, the request need not wait for it
      } yield (user, grant)

  /* ---------- Managing grants ---------- */

  def listGrants(user: User): Fox[List[OAuthGrant]] =
    grantDAO.findAllLiveByUser(user._id)

  def revokeGrantOfUser(user: User, grantId: ObjectId): Fox[Unit] =
    for {
      grant <- grantDAO.findLive(grantId) ?~> "Connection not found"
      _ <- Fox.fromBool(grant._user == user._id) ?~> "Connection not found"
      _ <- revokeGrant(grantId)
    } yield ()

  def revokeGrant(grantId: ObjectId): Fox[Unit] =
    for {
      _ <- grantDAO.markDeleted(grantId)
      _ <- codeDAO.deleteAllByGrant(grantId)
      _ <- tokenDAO.deleteAllByGrant(grantId)
      _ <- shortLivedTokenService.revokeAllForGrant(grantId)
    } yield ()

  def revokeAllForUsers(userIds: Seq[ObjectId]): Fox[Unit] =
    for {
      grantIds <- grantDAO.findAllLiveIdsByUsers(userIds)
      _ <- Fox.serialCombined(grantIds)(revokeGrant)
    } yield ()

  def removeExpired(): Fox[Unit] =
    for {
      _ <- codeDAO.deleteAllExpired()
      _ <- tokenDAO.deleteAllExpired()
      _ <- clientDAO.deleteUnusedCreatedBefore(Instant.now - unusedClientExpiry)
    } yield ()
}

object OAuthService {

  private val accessTokenPrefix = "wkoa_"
  private val registeredClientPrefix = "wkoc_"
  private val refreshTokenPrefix = "wkor_"

  // The levels the consent page offers, see security.Scope.Set.forLevel. They are also the OAuth scope values.
  val levels: List[ScopeMode.Value] = List(ScopeMode.read, ScopeMode.write, ScopeMode.delete)
  val defaultLevel: ScopeMode.Value = ScopeMode.write

  def levelFromString(s: String): Option[ScopeMode.Value] =
    ScopeMode.fromString(s).filter(levels.contains)

  // The strongest level the client asked for, as a suggestion for the consent page.
  def levelFromScope(scope: Option[String]): ScopeMode.Value =
    scope.toList
      .flatMap(_.split(' ').toList)
      .flatMap(levelFromString)
      .maxByOption(ScopeMode.rank)
      .getOrElse(defaultLevel)

  // 32 random bytes, base64url encoded.
  private def randomSecret(): String = RandomIDGenerator.generateBlocking(sizeInBytes = 32)

  // Codes and tokens are random enough that an unsalted hash is fine.
  def hash(secret: String): String =
    MessageDigest.getInstance("SHA-256").digest(secret.getBytes(StandardCharsets.UTF_8)).map("%02x".format(_)).mkString

  // RFC 7636: 43 to 128 characters of the unreserved set. A S256 challenge is 43 base64url characters.
  private val codeVerifierPattern = "^[A-Za-z0-9\\-._~]{43,128}$".r
  private val codeChallengePattern = "^[A-Za-z0-9\\-_]{43}$".r

  def isValidCodeChallenge(challenge: String): Boolean = codeChallengePattern.matches(challenge)

  def pkceMatches(codeVerifier: String, codeChallenge: String): Boolean =
    codeVerifierPattern.matches(codeVerifier) && {
      val digest = MessageDigest.getInstance("SHA-256").digest(codeVerifier.getBytes(StandardCharsets.US_ASCII))
      val computed = Base64.getUrlEncoder.withoutPadding.encodeToString(digest)
      MessageDigest.isEqual(
        computed.getBytes(StandardCharsets.US_ASCII),
        codeChallenge.getBytes(StandardCharsets.US_ASCII)
      )
    }

  def redirectUriMatches(registered: String, requested: String): Boolean =
    OAuthClientMetadataService.redirectUriMatches(registered, requested)

  private val maxRedirectUris = 10
  private val maxClientNameLength = 100

  /** Validates a client registration request (RFC 7591 section 2). Returns the client name and redirect URIs. Only the
    * authorization code flow is offered, and every client is public, so token_endpoint_auth_method is ignored and
    * overridden with "none" in the response, as the RFC allows.
    */
  def parseRegistrationRequest(
      request: JsValue,
      allowInsecure: Boolean
  ): Either[OAuthEndpointError, (String, List[String])] = {
    def invalidMetadata(description: String) = Left(OAuthEndpointError("invalid_client_metadata", description))
    request match {
      case body: JsObject =>
        for {
          redirectUris <- (body \ "redirect_uris").toOption match {
            case Some(JsArray(values)) if values.nonEmpty && values.forall(_.isInstanceOf[JsString]) =>
              Right(values.map(_.as[String]).toList)
            case _ => Left(OAuthEndpointError("invalid_redirect_uri", "redirect_uris must be a non-empty list"))
          }
          _ <- Either.cond(
            redirectUris.length <= maxRedirectUris,
            (),
            OAuthEndpointError("invalid_redirect_uri", s"At most $maxRedirectUris redirect_uris are allowed")
          )
          _ <- redirectUris.find(!OAuthClientMetadataService.isAcceptableRedirectUri(_, allowInsecure)) match {
            case Some(invalid) => Left(OAuthEndpointError("invalid_redirect_uri", s"Invalid redirect URI: $invalid"))
            case None          => Right(())
          }
          _ <- (body \ "grant_types").asOpt[List[String]] match {
            case Some(grantTypes) if !grantTypes.forall(Set("authorization_code", "refresh_token").contains) =>
              invalidMetadata("Supported grant_types are authorization_code and refresh_token")
            case _ => Right(())
          }
          _ <- (body \ "response_types").asOpt[List[String]] match {
            case Some(responseTypes) if !responseTypes.forall(_ == "code") =>
              invalidMetadata("The only supported response_type is code")
            case _ => Right(())
          }
          clientName = (body \ "client_name")
            .asOpt[String]
            .map(_.trim)
            .filter(_.nonEmpty)
            .map(_.take(maxClientNameLength))
            .getOrElse("Unnamed application")
        } yield (clientName, redirectUris)
      case _ => invalidMetadata("The registration request must be a JSON object")
    }
  }
}
