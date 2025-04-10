package security

import com.scalableminds.util.tools.{Fox, FoxImplicits, JsonHelper}
import com.scalableminds.webknossos.datastore.rpc.RPC
import com.typesafe.scalalogging.LazyLogging
import play.api.libs.json.{JsObject, Json, OFormat}
import pdi.jwt.JwtJson
import play.api.libs.ws._
import utils.WkConf

import java.math.BigInteger
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.security.spec.RSAPublicKeySpec
import java.security.{KeyFactory, PublicKey}
import java.util.Base64
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class OpenIdConnectClient @Inject()(rpc: RPC, conf: WkConf)(implicit ec: ExecutionContext)
    extends FoxImplicits
    with LazyLogging {

  private val keyTypeRsa = "RSA"

  private lazy val oidcConfig: OpenIdConnectConfig =
    OpenIdConnectConfig(
      conf.SingleSignOn.OpenIdConnect.providerUrl,
      conf.SingleSignOn.OpenIdConnect.clientId,
      if (conf.SingleSignOn.OpenIdConnect.clientSecret.nonEmpty) Some(conf.SingleSignOn.OpenIdConnect.clientSecret)
      else None,
      conf.SingleSignOn.OpenIdConnect.scope,
    )

  /*
   Build redirect URL to redirect to OIDC provider for auth request (https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)
   */
  def getRedirectUrl(callbackUrl: String): Fox[String] =
    for {
      _ <- Fox.fromBool(conf.Features.openIdConnectEnabled) ?~> "oidc.disabled"
      _ <- Fox.fromBool(oidcConfig.isValid) ?~> "oidc.configuration.invalid"
      redirectUrl <- discover.map { serverInfos =>
        def queryParams: Map[String, String] = Map(
          "client_id" -> oidcConfig.clientId,
          "redirect_uri" -> callbackUrl,
          "scope" -> oidcConfig.scope,
          "response_type" -> "code",
        )
        serverInfos.authorization_endpoint + "?" +
          queryParams.map(v => v._1 + "=" + URLEncoder.encode(v._2, StandardCharsets.UTF_8.toString)).mkString("&")
      }
    } yield redirectUrl

  /*
  Fetches token from the oidc provider (https://openid.net/specs/openid-connect-core-1_0.html#TokenRequest),
  fields described by https://www.rfc-editor.org/rfc/rfc6749#section-4.4.2
  Note that some providers will also reply with an id token next to the auth token, which is also returned as an option.
   */
  def getAndValidateTokens(redirectUrl: String, code: String): Fox[(JsObject, Option[JsObject])] =
    for {
      _ <- Fox.fromBool(conf.Features.openIdConnectEnabled) ?~> "oidc.disabled"
      _ <- Fox.fromBool(oidcConfig.isValid) ?~> "oidc.configuration.invalid"
      serverInfos <- discover
      tokenResponse <- rpc(serverInfos.token_endpoint)
        .silentIf(!conf.SingleSignOn.OpenIdConnect.verboseLoggingEnabled)
        .withBasicAuthOpt(Some(oidcConfig.clientId), oidcConfig.clientSecret)
        .postFormWithJsonResponse[OpenIdConnectTokenResponse](
          Map(
            "grant_type" -> "authorization_code",
            "client_id" -> oidcConfig.clientId,
            "redirect_uri" -> redirectUrl,
            "code" -> code,
            "scope" -> oidcConfig.scope
          ))
      _ = logDebug(
        s"Fetched oidc token for scope '${oidcConfig.scope}', response scope: ${tokenResponse.scope}. Decoding...")
      (accessToken, idToken) <- validateOpenIdConnectTokenResponse(tokenResponse, serverInfos) ?~> "failed to parse JWT"
      _ = logDebug(s"Got id token $idToken and access token $accessToken.")
    } yield (accessToken, idToken)

  /*
  Discover endpoints of the provider (https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig)
   */
  private def discover: Fox[OpenIdConnectProviderInfo] =
    for {
      response: WSResponse <- rpc(oidcConfig.discoveryUrl)
        .silentIf(!conf.SingleSignOn.OpenIdConnect.verboseLoggingEnabled)
        .get
      serverInfo <- response.json.validate[OpenIdConnectProviderInfo](OpenIdConnectProviderInfo.format)
    } yield serverInfo

  private def validateOpenIdConnectTokenResponse(
      tokenResponse: OpenIdConnectTokenResponse,
      serverInfos: OpenIdConnectProviderInfo): Fox[(JsObject, Option[JsObject])] =
    for {
      publicKey <- fetchServerPublicKey(serverInfos)
      decdoedAccessToken <- JwtJson.decodeJson(tokenResponse.access_token, publicKey).toFox
      decodedIdToken: Option[JsObject] <- Fox.runOptional(tokenResponse.id_token)(idToken =>
        JwtJson.decodeJson(idToken, publicKey).toFox)
    } yield (decdoedAccessToken, decodedIdToken)

  private def fetchServerPublicKey(serverInfos: OpenIdConnectProviderInfo): Fox[PublicKey] =
    for {
      response: WSResponse <- rpc(serverInfos.jwks_uri)
        .silentIf(!conf.SingleSignOn.OpenIdConnect.verboseLoggingEnabled)
        .get
      jsonWebKeySet: JsonWebKeySet <- JsonHelper.validateJsValue[JsonWebKeySet](response.json).toFox
      firstRsaKey: JsonWebKey <- Fox.option2Fox(jsonWebKeySet.keys.find(key =>
        key.kty == keyTypeRsa && key.use == "sig")) ?~> "No server RSA Public Key found in server key set"
      modulusString <- firstRsaKey.n
      modulus = new BigInteger(1, Base64.getUrlDecoder.decode(modulusString.getBytes))
      exponentString <- firstRsaKey.e
      exponent = new BigInteger(1, Base64.getUrlDecoder.decode(exponentString.getBytes))
      publicKeySpec = new RSAPublicKeySpec(modulus, exponent)
      publicKey = KeyFactory.getInstance(keyTypeRsa).generatePublic(publicKeySpec)
    } yield publicKey

  private def logDebug(message: String): Unit = if (conf.SingleSignOn.OpenIdConnect.verboseLoggingEnabled) {
    logger.info(message)
  }
}

// Fields as specified by https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
case class OpenIdConnectProviderInfo(
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: String,
    jwks_uri: String
)

object OpenIdConnectProviderInfo {
  implicit val format: OFormat[OpenIdConnectProviderInfo] = Json.format[OpenIdConnectProviderInfo]
}

case class OpenIdConnectConfig(
    baseUrl: String,
    clientId: String,
    clientSecret: Option[String],
    scope: String
) {

  lazy val discoveryUrl: String = baseUrl + ".well-known/openid-configuration"

  def isValid: Boolean =
    baseUrl.nonEmpty
}

// Fields as specified by https://www.rfc-editor.org/rfc/rfc6749#section-5.1
case class OpenIdConnectTokenResponse(
    access_token: String,
    id_token: Option[String],
    token_type: String,
    refresh_token: Option[String],
    scope: Option[String]
)

object OpenIdConnectTokenResponse {
  implicit val format: OFormat[OpenIdConnectTokenResponse] = Json.format[OpenIdConnectTokenResponse]
}

// Claims as specified by https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
case class OpenIdConnectUserInfo(given_name: String, family_name: String, email: String)
object OpenIdConnectUserInfo {
  implicit val format: OFormat[OpenIdConnectUserInfo] = Json.format[OpenIdConnectUserInfo]
}

case class JsonWebKeySet(keys: Seq[JsonWebKey])
object JsonWebKeySet {
  implicit val jsonFormat: OFormat[JsonWebKeySet] = Json.format[JsonWebKeySet]
}

// Specified by https://datatracker.ietf.org/doc/html/rfc7517#section-4
// and RSA-specific by https://datatracker.ietf.org/doc/html/rfc7518#section-6.3.1
case class JsonWebKey(
    kty: String, // key type
    alg: String, // algorithm
    use: String, // usage (sig for signature or enc for encryption)
    n: Option[String], // rsa modulus
    e: Option[String] // rsa exponent
)

object JsonWebKey {
  implicit val jsonFormat: OFormat[JsonWebKey] = Json.format[JsonWebKey]
}
