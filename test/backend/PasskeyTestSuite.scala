package backend

import com.scalableminds.util.box.Full
import com.scalableminds.util.objectid.ObjectId
import com.webauthn4j.credential.CredentialRecordImpl as WebAuthnCredentialRecord
import com.webauthn4j.data.*
import com.webauthn4j.data.attestation.statement.COSEAlgorithmIdentifier
import com.webauthn4j.data.client.Origin
import com.webauthn4j.data.client.challenge.DefaultChallenge
import com.webauthn4j.test.authenticator.webauthn.{PackedAuthenticator, WebAuthnAuthenticatorAdaptor}
import com.webauthn4j.test.client.ClientPlatform
import models.user.SerializedWebAuthnCredentialRecord
import org.apache.commons.codec.binary.Base64
import org.scalatestplus.play.PlaySpec
import play.api.libs.json.*
import security.{WebAuthnChallenge, WebAuthnVerifier}

import java.security.SecureRandom
import scala.concurrent.duration.*
import scala.jdk.CollectionConverters.*

/** Runs passkey registration and login against an emulated authenticator (from webauthn4j-test).
  *
  * The emulator stands in for the browser and the security key / platform authenticator. It is fed the JSON options
  * webknossos sends to the browser, and its responses are encoded in the JSON format that @github/webauthn-json
  * produces in the frontend. In between, credentials take the same serialization round trip as through the database.
  * This catches regressions when changing the passkey code or upgrading webauthn4j, without needing a browser.
  */
class PasskeyTestSuite extends PlaySpec {

  private val origin = new Origin("https://webknossos.example.org")
  private val verifier = new WebAuthnVerifier(origin, 2 minutes)
  private val secureRandom = new SecureRandom()
  private val multiUserId = ObjectId.generate

  private def b64(bytes: Array[Byte]): String = Base64.encodeBase64URLSafeString(bytes)
  private def unb64(s: String): Array[Byte] = Base64.decodeBase64(s)

  private def newChallenge(): Array[Byte] = {
    val challenge = new Array[Byte](32)
    secureRandom.nextBytes(challenge)
    challenge
  }

  // Like a browser: reads the creation options JSON sent by webknossos and asks the authenticator to create a credential.
  private def browserCreate(
      client: ClientPlatform,
      optionsJson: JsValue
  ): PublicKeyCredential[AuthenticatorAttestationResponse, extension.client.RegistrationExtensionClientOutput] = {
    val selection = optionsJson \ "authenticatorSelection"
    val options = new PublicKeyCredentialCreationOptions(
      new PublicKeyCredentialRpEntity((optionsJson \ "rp" \ "id").as[String], (optionsJson \ "rp" \ "name").as[String]),
      new PublicKeyCredentialUserEntity(
        unb64((optionsJson \ "user" \ "id").as[String]),
        (optionsJson \ "user" \ "name").as[String],
        (optionsJson \ "user" \ "displayName").as[String]
      ),
      new DefaultChallenge(unb64((optionsJson \ "challenge").as[String])),
      (optionsJson \ "pubKeyCredParams")
        .as[Seq[JsObject]]
        .map(p =>
          new PublicKeyCredentialParameters(
            PublicKeyCredentialType.create((p \ "type").as[String]),
            COSEAlgorithmIdentifier.create((p \ "alg").as[Long])
          )
        )
        .asJava,
      (optionsJson \ "timeout").as[Long],
      (optionsJson \ "excludeCredentials")
        .as[Seq[JsObject]]
        .map(c =>
          new PublicKeyCredentialDescriptor(
            PublicKeyCredentialType.create((c \ "type").as[String]),
            unb64((c \ "id").as[String]),
            null
          )
        )
        .asJava,
      new AuthenticatorSelectionCriteria(
        null,
        (selection \ "requireResidentKey").as[Boolean],
        ResidentKeyRequirement.create((selection \ "residentKey").as[String]),
        UserVerificationRequirement.create((selection \ "userVerification").as[String])
      ),
      AttestationConveyancePreference.create((optionsJson \ "attestation").as[String]),
      null
    )
    client.create(options)
  }

  // Like a browser: reads the request options JSON sent by webknossos and asks the authenticator for an assertion.
  private def browserGet(
      client: ClientPlatform,
      optionsJson: JsValue
  ): PublicKeyCredential[AuthenticatorAssertionResponse, extension.client.AuthenticationExtensionClientOutput] = {
    val options = new PublicKeyCredentialRequestOptions(
      new DefaultChallenge(unb64((optionsJson \ "challenge").as[String])),
      (optionsJson \ "timeout").as[Long],
      (optionsJson \ "rpId").as[String],
      null, // no allowCredentials, the authenticator discovers the passkey (resident key)
      UserVerificationRequirement.create((optionsJson \ "userVerification").as[String]),
      null,
      null
    )
    client.get(options)
  }

  // Shape of the JSON that @github/webauthn-json's create() returns in the frontend.
  private def registrationResponseJson(
      credential: PublicKeyCredential[AuthenticatorAttestationResponse, ?]
  ): JsValue =
    Json.obj(
      "type" -> "public-key",
      "id" -> b64(credential.getRawId),
      "rawId" -> b64(credential.getRawId),
      "authenticatorAttachment" -> "cross-platform",
      "response" -> Json.obj(
        "clientDataJSON" -> b64(credential.getResponse.getClientDataJSON),
        "attestationObject" -> b64(credential.getResponse.getAttestationObject),
        "transports" -> Json.arr("usb")
      ),
      "clientExtensionResults" -> Json.obj()
    )

  // Shape of the JSON that @github/webauthn-json's get() returns in the frontend.
  private def authenticationResponseJson(
      credential: PublicKeyCredential[AuthenticatorAssertionResponse, ?]
  ): JsValue =
    Json.obj(
      "type" -> "public-key",
      "id" -> b64(credential.getRawId),
      "rawId" -> b64(credential.getRawId),
      "authenticatorAttachment" -> "cross-platform",
      "response" -> Json.obj(
        "clientDataJSON" -> b64(credential.getResponse.getClientDataJSON),
        "authenticatorData" -> b64(credential.getResponse.getAuthenticatorData),
        "signature" -> b64(credential.getResponse.getSignature),
        "userHandle" -> b64(credential.getResponse.getUserHandle)
      ),
      "clientExtensionResults" -> Json.obj()
    )

  // Same round trip as WebAuthnCredentialDAO.insertOne followed by WebAuthnCredentialDAO.parse.
  private def storeAndLoad(record: WebAuthnCredentialRecord): WebAuthnCredentialRecord = {
    val serialized = SerializedWebAuthnCredentialRecord.serialize(record).getOrElse(fail("serialization failed"))
    SerializedWebAuthnCredentialRecord
      .deserialize(
        attestationStatementJson = Json.stringify(serialized.attestationStatement),
        attestedCredential = serialized.attestedCredential,
        extensionsJson = Json.stringify(serialized.extensions),
        userVerified = serialized.userVerified,
        backupEligible = serialized.backupEligible,
        backupState = serialized.backupState,
        signatureCount = serialized.signatureCount
      )
      .getOrElse(fail("deserialization failed"))
  }

  private def register(
      client: ClientPlatform,
      existingCredentialIds: Seq[Array[Byte]] = Seq.empty
  ): (WebAuthnCredentialRecord, Array[Byte]) = {
    val challenge = newChallenge()
    val options = verifier.registrationOptions(
      challenge,
      multiUserId,
      displayName = "Test User",
      email = "test@example.org",
      excludeCredentialIds = existingCredentialIds
    )
    val credential = browserCreate(client, Json.toJson(options))
    val record = (for {
      registrationData <- verifier.parseRegistration(registrationResponseJson(credential))
      record <- verifier.verifyRegistration(registrationData, WebAuthnChallenge(challenge))
    } yield record).getOrElse(fail("registration failed"))
    (storeAndLoad(record), credential.getRawId)
  }

  // Hardware security keys usually have a signature counter, synced passkeys (Apple, Google) always send 0.
  private def newClient(withSignCounter: Boolean = true) = {
    val authenticator = new PackedAuthenticator()
    authenticator.setCountUpEnabled(withSignCounter)
    new ClientPlatform(origin, new WebAuthnAuthenticatorAdaptor(authenticator))
  }

  // Prepares a login like the browser does it, returning the response and the challenge it answers.
  private def prepareLogin(client: ClientPlatform): (AuthenticationData, Array[Byte]) = {
    val challenge = newChallenge()
    val assertion = browserGet(client, Json.toJson(verifier.authenticationOptions(challenge)))
    val authData =
      verifier.parseAuthentication(authenticationResponseJson(assertion)).getOrElse(fail("parsing login failed"))
    (authData, challenge)
  }

  // Like webauthnAuthFinalize: verify, then persist the updated sign count.
  private def finishLogin(
      authData: AuthenticationData,
      challenge: Array[Byte],
      storedRecord: WebAuthnCredentialRecord
  ): Option[WebAuthnCredentialRecord] =
    verifier
      .verifyAuthentication(authData, WebAuthnChallenge(challenge), storedRecord)
      .toOption
      .map(_ => storeAndLoad(storedRecord))

  private def login(
      client: ClientPlatform,
      storedRecord: WebAuthnCredentialRecord
  ): Option[WebAuthnCredentialRecord] = {
    val (authData, challenge) = prepareLogin(client)
    finishLogin(authData, challenge, storedRecord)
  }

  "Passkeys" should {

    "be registered and then used to log in" in {
      val client = newClient()
      val (storedRecord, credentialId) = register(client)
      storedRecord.getAttestedCredentialData.getCredentialId mustBe credentialId
      storedRecord.getAttestedCredentialData.getCOSEKey.getAlgorithm mustBe COSEAlgorithmIdentifier.ES256

      val (authData, challenge) = prepareLogin(client)
      authData.getCredentialId mustBe credentialId
      verifier.multiUserIdFromAuthentication(authData) mustBe Full(multiUserId)
      val updatedRecord = finishLogin(authData, challenge, storedRecord).getOrElse(fail("login failed"))
      updatedRecord.getCounter mustBe authData.getAuthenticatorData.getSignCount
    }

    "log in repeatedly with a passkey that has a sign counter" in {
      val client = newClient()
      val (registeredRecord, _) = register(client)
      registeredRecord.getCounter must be > 0L
      val afterFirstLogin = login(client, registeredRecord).getOrElse(fail("first login failed"))
      val counterAfterFirstLogin = afterFirstLogin.getCounter // verify updates the passed record in place
      val afterSecondLogin = login(client, afterFirstLogin).getOrElse(fail("second login failed"))
      afterSecondLogin.getCounter must be > counterAfterFirstLogin
    }

    "log in repeatedly with a passkey without sign counter" in {
      val client = newClient(withSignCounter = false)
      val (registeredRecord, _) = register(client)
      registeredRecord.getCounter mustBe 0L
      val afterFirstLogin = login(client, registeredRecord).getOrElse(fail("first login failed"))
      login(client, afterFirstLogin).isDefined mustBe true
    }

    "reject a login whose sign count did not increase (cloned authenticator)" in {
      val client = newClient()
      val (storedRecord, _) = register(client)
      val (olderAuthData, olderChallenge) = prepareLogin(client)
      val (newerAuthData, newerChallenge) = prepareLogin(client)
      val afterNewerLogin = finishLogin(newerAuthData, newerChallenge, storedRecord).getOrElse(fail("login failed"))
      finishLogin(olderAuthData, olderChallenge, afterNewerLogin) mustBe None
    }

    "reject a login answering a different challenge" in {
      val client = newClient()
      val (storedRecord, _) = register(client)

      val assertion = browserGet(client, Json.toJson(verifier.authenticationOptions(newChallenge())))
      val authData =
        verifier.parseAuthentication(authenticationResponseJson(assertion)).getOrElse(fail("parsing login failed"))
      verifier.verifyAuthentication(authData, WebAuthnChallenge(newChallenge()), storedRecord).isEmpty mustBe true
    }

    "reject a login from another origin" in {
      val client = newClient()
      val (storedRecord, _) = register(client)

      client.setOrigin(new Origin("https://phishing.example.com"))
      val challenge = newChallenge()
      val assertion = browserGet(client, Json.toJson(verifier.authenticationOptions(challenge)))
      val authData =
        verifier.parseAuthentication(authenticationResponseJson(assertion)).getOrElse(fail("parsing login failed"))
      verifier.verifyAuthentication(authData, WebAuthnChallenge(challenge), storedRecord).isEmpty mustBe true
    }

    "reject a login with a passkey that is not the stored one" in {
      val (storedRecord, _) = register(newClient())
      val otherClient = newClient()
      register(otherClient)

      val challenge = newChallenge()
      val assertion = browserGet(otherClient, Json.toJson(verifier.authenticationOptions(challenge)))
      val authData =
        verifier.parseAuthentication(authenticationResponseJson(assertion)).getOrElse(fail("parsing login failed"))
      verifier.verifyAuthentication(authData, WebAuthnChallenge(challenge), storedRecord).isEmpty mustBe true
    }

    "reject a registration answering a different challenge" in {
      val options =
        verifier.registrationOptions(newChallenge(), multiUserId, "Test User", "test@example.org", Seq.empty)
      val credential = browserCreate(newClient(), Json.toJson(options))
      val registrationData =
        verifier.parseRegistration(registrationResponseJson(credential)).getOrElse(fail("parsing failed"))
      verifier.verifyRegistration(registrationData, WebAuthnChallenge(newChallenge())).isEmpty mustBe true
    }

    "not register the same authenticator twice" in {
      val client = newClient()
      val (_, credentialId) = register(client)
      val options =
        verifier.registrationOptions(newChallenge(), multiUserId, "Test User", "test@example.org", Seq(credentialId))
      // The authenticator refuses because the passkey is listed in excludeCredentials.
      an[Exception] must be thrownBy browserCreate(client, Json.toJson(options))
    }
  }
}
