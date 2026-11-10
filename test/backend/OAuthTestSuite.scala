package backend

import oauth.{OAuthClientMetadataService, OAuthService}
import org.scalatest.wordspec.AnyWordSpec
import play.api.libs.json.Json
import security.ScopeMode

import java.net.InetAddress

class OAuthTestSuite extends AnyWordSpec {

  import OAuthClientMetadataService.*

  private val clientId = "https://client.example.com/oauth/metadata.json"

  "OAuthService.pkceMatches" should {
    // The example from RFC 7636, appendix B.
    val verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    val challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"

    "accept the matching verifier" in
      assert(OAuthService.pkceMatches(verifier, challenge))

    "reject another verifier" in
      assert(!OAuthService.pkceMatches(verifier.reverse, challenge))

    "reject verifiers that are too short or contain invalid characters" in {
      assert(!OAuthService.pkceMatches("short", challenge))
      assert(!OAuthService.pkceMatches(verifier.dropRight(1) + "!", challenge))
    }

    "check the format of challenges" in {
      assert(OAuthService.isValidCodeChallenge(challenge))
      assert(!OAuthService.isValidCodeChallenge(challenge + "="))
      assert(!OAuthService.isValidCodeChallenge("plain"))
    }
  }

  "OAuthService.levelFromScope" should {
    "pick the strongest requested level" in {
      assert(OAuthService.levelFromScope(Some("read")) == ScopeMode.read)
      assert(OAuthService.levelFromScope(Some("read delete write")) == ScopeMode.delete)
    }

    "fall back to the default for missing or unknown scopes" in {
      assert(OAuthService.levelFromScope(None) == OAuthService.defaultLevel)
      assert(OAuthService.levelFromScope(Some("openid profile")) == OAuthService.defaultLevel)
      assert(OAuthService.levelFromScope(Some("administrate")) == OAuthService.defaultLevel)
    }
  }

  "OAuthService.parseRegistrationRequest" should {
    val valid = Json.obj(
      "client_name" -> "Claude Code",
      "redirect_uris" -> Json.arr("http://localhost/callback"),
      "grant_types" -> Json.arr("authorization_code", "refresh_token"),
      "response_types" -> Json.arr("code"),
      "token_endpoint_auth_method" -> "none"
    )
    def parse(request: play.api.libs.json.JsValue) =
      OAuthService.parseRegistrationRequest(request, allowInsecure = false)

    "accept a valid registration" in
      assert(parse(valid) == Right(("Claude Code", List("http://localhost/callback"))))

    "accept clients asking for a secret, which they do not get" in
      assert(parse(valid ++ Json.obj("token_endpoint_auth_method" -> "client_secret_post")).isRight)

    "default the client name" in
      assert(parse(valid - "client_name").map(_._1) == Right("Unnamed application"))

    "require valid redirect URIs" in {
      assert(parse(valid - "redirect_uris").left.map(_.error) == Left("invalid_redirect_uri"))
      assert(parse(valid ++ Json.obj("redirect_uris" -> Json.arr())).isLeft)
      assert(parse(valid ++ Json.obj("redirect_uris" -> Json.arr("javascript:alert(1)"))).isLeft)
      assert(parse(valid ++ Json.obj("redirect_uris" -> Json.arr("http://evil.example.com/cb"))).isLeft)
      assert(parse(valid ++ Json.obj("redirect_uris" -> Json.arr((1 to 11).map(i => s"https://a.com/$i")))).isLeft)
    }

    "reject other flows" in {
      assert(
        parse(valid ++ Json.obj("grant_types" -> Json.arr("client_credentials"))).left.map(_.error) ==
          Left("invalid_client_metadata")
      )
      assert(parse(valid ++ Json.obj("response_types" -> Json.arr("token"))).isLeft)
    }

    "reject non-objects" in
      assert(parse(Json.arr()).isLeft)
  }

  "OAuthService.hash" should {
    "be stable and not reveal the secret" in {
      assert(OAuthService.hash("secret") == OAuthService.hash("secret"))
      assert(OAuthService.hash("secret") != OAuthService.hash("secret2"))
      assert(!OAuthService.hash("secret").contains("secret"))
    }
  }

  "OAuthClientMetadataService.redirectUriMatches" should {
    "require an exact match" in {
      assert(redirectUriMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback"))
      assert(!redirectUriMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/"))
      assert(!redirectUriMatches("https://claude.ai/callback", "https://evil.example.com/callback"))
      assert(!redirectUriMatches("https://claude.ai/callback", "https://claude.ai:8443/callback"))
    }

    "ignore the port of loopback redirect URIs only" in {
      assert(redirectUriMatches("http://localhost/callback", "http://localhost:53682/callback"))
      assert(redirectUriMatches("http://127.0.0.1:1234/callback", "http://127.0.0.1:5678/callback"))
      assert(!redirectUriMatches("http://localhost/callback", "http://localhost:53682/other"))
      assert(!redirectUriMatches("http://localhost/callback", "http://127.0.0.1:53682/callback"))
      assert(!redirectUriMatches("https://localhost/callback", "https://localhost:53682/callback"))
    }
  }

  "OAuthClientMetadataService.validateClientIdUrl" should {
    "accept https URLs with a path" in
      assert(validateClientIdUrl(clientId, allowInsecure = false).isRight)

    "reject anything else" in {
      assert(validateClientIdUrl("http://client.example.com/metadata.json", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("https://client.example.com", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("https://client.example.com/", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("https://client.example.com/a#fragment", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("https://user@client.example.com/a", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("https://client.example.com/a/../b", allowInsecure = false).isLeft)
      assert(validateClientIdUrl("my-client", allowInsecure = false).isLeft)
    }

    "accept http only if insecure URLs are allowed" in
      assert(validateClientIdUrl("http://localhost:1234/metadata.json", allowInsecure = true).isRight)
  }

  "OAuthClientMetadataService.isPublicAddress" should {
    "accept public addresses" in {
      assert(isPublicAddress(InetAddress.getByName("8.8.8.8")))
      assert(isPublicAddress(InetAddress.getByName("2001:4860:4860::8888")))
    }

    "reject internal addresses" in
      List(
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254", // cloud metadata services
        "100.64.0.1",
        "0.0.0.0",
        "::1",
        "fd00::1",
        "fe80::1",
        "::ffff:10.0.0.1"
      ).foreach(address => assert(!isPublicAddress(InetAddress.getByName(address)), address))
  }

  "OAuthClientMetadataService.parseDocument" should {
    val valid = Json.obj(
      "client_id" -> clientId,
      "client_name" -> "Example Client",
      "redirect_uris" -> Json.arr("https://client.example.com/callback", "http://localhost/callback"),
      "token_endpoint_auth_method" -> "none"
    )

    "read a valid document" in {
      val parsed = parseDocument(clientId, valid, allowInsecure = false)
      assert(parsed.map(_.clientName) == Right("Example Client"))
      assert(parsed.map(_.redirectUris.length) == Right(2))
    }

    "fall back to the host as the client name" in
      assert(
        parseDocument(clientId, valid - "client_name", allowInsecure = false).map(_.clientName) ==
          Right("client.example.com")
      )

    "require the client_id to match the URL it was fetched from" in
      assert(
        parseDocument(clientId, valid ++ Json.obj("client_id" -> "https://other.example.com/m.json"), false).isLeft
      )

    "require redirect URIs" in {
      assert(parseDocument(clientId, valid - "redirect_uris", allowInsecure = false).isLeft)
      assert(parseDocument(clientId, valid ++ Json.obj("redirect_uris" -> Json.arr()), allowInsecure = false).isLeft)
    }

    "reject confidential clients" in {
      assert(
        parseDocument(clientId, valid ++ Json.obj("token_endpoint_auth_method" -> "private_key_jwt"), false).isLeft
      )
      assert(parseDocument(clientId, valid ++ Json.obj("client_secret" -> "s3cret"), allowInsecure = false).isLeft)
    }

    "reject dangerous or non-loopback http redirect URIs" in
      List(
        "javascript:alert(1)",
        "http://client.example.com/callback",
        "data:text/html,x",
        "https://a.com/cb#f"
      ).foreach { uri =>
        assert(parseDocument(clientId, valid ++ Json.obj("redirect_uris" -> Json.arr(uri)), false).isLeft, uri)
      }

    "accept private-use schemes of native apps" in
      assert(
        parseDocument(
          clientId,
          valid ++ Json.obj("redirect_uris" -> Json.arr("cursor://oauth/callback")),
          false
        ).isRight
      )
  }
}
