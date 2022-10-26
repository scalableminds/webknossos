package oxalis.security

import com.scalableminds.util.tools.Fox
import com.scalableminds.util.tools.Fox.{bool2Fox, jsResult2Fox, try2Fox}
import com.scalableminds.webknossos.datastore.rpc.RPC
import play.api.libs.json.{JsObject, Json, OFormat}
import pdi.jwt.{JwtJson, JwtOptions}
import play.api.libs.ws._
import utils.WkConf

import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import javax.inject.Inject
import scala.concurrent.ExecutionContext

class OpenIdConnectClient @Inject()(rpc: RPC, conf: WkConf)(implicit executionContext: ExecutionContext) {

  lazy val oidcConfig: OpenIdConnectConfig =
    OpenIdConnectConfig(conf.SingleSignOn.OIDC.providerUrl, conf.SingleSignOn.OIDC.clientId)

  /*
   Build redirect URL to redirect to OIDC provider for auth request (https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest)
   */
  def getRedirectUrl(callbackUrl: String): Fox[String] =
    for {
      _ <- bool2Fox(oidcConfig.isValid) ?~> "OIDC config invalid"
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
  Fetches token form the oidc provider (https://openid.net/specs/openid-connect-core-1_0.html#TokenRequest),
  fields described by https://www.rfc-editor.org/rfc/rfc6749#section-4.4.2
   */
  def getToken(redirectUrl: String, code: String): Fox[JsObject] =
    for {
      _ <- bool2Fox(oidcConfig.isValid) ?~> "OIDC config invalid"
      serverInfos <- discover
      tokenResponse <- rpc(serverInfos.token_endpoint).postFormParseJson[OpenIdConnectTokenResponse](
        Map(
          "grant_type" -> "authorization_code",
          "client_id" -> oidcConfig.clientId,
          "redirect_uri" -> redirectUrl,
          "code" -> code
        ))
      newToken <- JwtJson
        .decodeJson(tokenResponse.access_token, JwtOptions.DEFAULT.copy(signature = false))
        .toFox ?~> "failed to parse JWT"
    } yield newToken

  /*
  Discover endpoints of the provider (https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderConfig)
   */
  def discover: Fox[OpenIdConnectProviderInfo] =
    for {
      response: WSResponse <- rpc(oidcConfig.discoveryUrl).get
      serverInfo <- response.json.validate[OpenIdConnectProviderInfo](OpenIdConnectProviderInfo.format)
    } yield serverInfo

}

// Fields as specified by https://openid.net/specs/openid-connect-discovery-1_0.html#ProviderMetadata
case class OpenIdConnectProviderInfo(
    authorization_endpoint: String,
    token_endpoint: String,
)

object OpenIdConnectProviderInfo {
  implicit val format: OFormat[OpenIdConnectProviderInfo] = Json.format[OpenIdConnectProviderInfo]
}

case class OpenIdConnectConfig(
    baseUrl: String,
    clientId: String,
    scope: String = "openid profile"
) {

  lazy val discoveryUrl: String = baseUrl + ".well-known/openid-configuration"

  def isValid: Boolean =
    baseUrl.nonEmpty
}

// Fields as specified by https://www.rfc-editor.org/rfc/rfc6749#section-5.1
case class OpenIdConnectTokenResponse(
    access_token: String,
    token_type: String,
    expires_in: Option[String],
    refresh_token: Option[String],
    scope: Option[String]
)

object OpenIdConnectTokenResponse {
  implicit val format: OFormat[OpenIdConnectTokenResponse] = Json.format[OpenIdConnectTokenResponse]
}

// Claims from https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims
case class OpenIdConnectClaimSet(iss: String,
                                 sub: String,
                                 preferred_username: String,
                                 given_name: String,
                                 family_name: String,
                                 email: String) {
  def username: String = preferred_username
}

object OpenIdConnectClaimSet {
  implicit val format = Json.format[OpenIdConnectClaimSet]
}
