package security

import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import com.scalableminds.util.objectid.ObjectId
import com.webauthn4j.WebAuthnManager
import com.webauthn4j.credential.CredentialRecordImpl as WebAuthnCredentialRecord
import com.webauthn4j.data.attestation.statement.COSEAlgorithmIdentifier
import com.webauthn4j.data.client.Origin
import com.webauthn4j.data.client.challenge.Challenge
import com.webauthn4j.data.{
  AuthenticationData,
  AuthenticationParameters,
  PublicKeyCredentialParameters,
  PublicKeyCredentialType,
  RegistrationData,
  RegistrationParameters
}
import com.webauthn4j.server.ServerProperty
import org.apache.commons.codec.binary.Base64
import play.api.libs.json.{JsValue, Json}

import scala.concurrent.duration.FiniteDuration
import scala.jdk.CollectionConverters.*

/** The passkey (WebAuthn) protocol logic: building the options sent to the browser and verifying its responses.
  *
  * Kept free of HTTP, cookies and database access so that it can be exercised with an emulated authenticator in backend
  * tests (see PasskeyTestSuite).
  */
class WebAuthnVerifier(origin: Origin, timeout: FiniteDuration) {

  private val webAuthnManager = WebAuthnManager.createNonStrictWebAuthnManager()
  private val rpId = origin.getHost

  private def serverProperty(challenge: Challenge) =
    ServerProperty.builder().origin(origin).rpId(rpId).challenge(challenge).build()

  def registrationOptions(
      challenge: Array[Byte],
      multiUserId: ObjectId,
      displayName: String,
      email: String,
      excludeCredentialIds: Seq[Array[Byte]]
  ): WebAuthnPublicKeyCredentialCreationOptions =
    WebAuthnPublicKeyCredentialCreationOptions(
      authenticatorSelection = WebAuthnCreationOptionsAuthenticatorSelection(),
      challenge = Base64.encodeBase64URLSafeString(challenge),
      excludeCredentials = excludeCredentialIds
        .map(id => WebAuthnCreationOptionsExcludeCredentials(id = Base64.encodeBase64URLSafeString(id)))
        .toArray,
      pubKeyCredParams = WebAuthnVerifier.pubKeyParams,
      timeout = timeout.toMillis.toInt,
      rp = WebAuthnCreationOptionsRelyingParty(id = rpId, name = rpId),
      user = WebAuthnCreationOptionsUser(
        displayName = displayName,
        id = Base64.encodeBase64URLSafeString(WebAuthnVerifier.userHandle(multiUserId)),
        name = email
      )
    )

  def authenticationOptions(challenge: Array[Byte]): WebAuthnPublicKeyCredentialRequestOptions =
    WebAuthnPublicKeyCredentialRequestOptions(
      challenge = Base64.encodeBase64URLSafeString(challenge),
      timeout = Some(timeout.toMillis),
      rpId = Some(rpId),
      userVerification = Some("preferred"),
      hints = None
    )

  def parseRegistration(key: JsValue): Box[RegistrationData] =
    tryo(webAuthnManager.parseRegistrationResponseJSON(Json.stringify(key)))

  def verifyRegistration(registrationData: RegistrationData, challenge: Challenge): Box[WebAuthnCredentialRecord] = {
    val publicKeyParams = WebAuthnVerifier.pubKeyParams.map(k =>
      new PublicKeyCredentialParameters(PublicKeyCredentialType.PUBLIC_KEY, COSEAlgorithmIdentifier.create(k.alg))
    )
    val registrationParams =
      new RegistrationParameters(serverProperty(challenge), publicKeyParams.toList.asJava, false, true)
    for {
      _ <- tryo(webAuthnManager.verify(registrationData, registrationParams))
    } yield new WebAuthnCredentialRecord(
      registrationData.getAttestationObject,
      null, // clientData - Client data is not collected.
      null, // clientExtensions - Client extensions are ignored.
      null // transports - All transports are allowed.
    )
  }

  def parseAuthentication(key: JsValue): Box[AuthenticationData] =
    tryo(webAuthnManager.parseAuthenticationResponseJSON(Json.stringify(key)))

  def multiUserIdFromAuthentication(authData: AuthenticationData): Box[ObjectId] =
    for {
      userHandle <- Box.fromOption(Option(authData.getUserHandle))
      multiUserId <- Box.fromOption(ObjectId.fromStringSync(new String(userHandle)))
    } yield multiUserId

  /** Besides checking the signature, webauthn4j rejects a sign count that did not increase (a hint for a cloned
    * authenticator; authenticators without counter always send 0). On success, it updates the counter of
    * credentialRecord in place, which then needs to be persisted.
    */
  def verifyAuthentication(
      authData: AuthenticationData,
      challenge: Challenge,
      credentialRecord: WebAuthnCredentialRecord
  ): Box[Unit] = {
    val params = new AuthenticationParameters(
      serverProperty(challenge),
      credentialRecord,
      null,
      false, // User verification is not required but preferred.
      false // User presence is not required.
    )
    tryo(webAuthnManager.verify(authData, params)).map(_ => ())
  }
}

object WebAuthnVerifier {
  val pubKeyParams: Array[WebAuthnCreationOptionsPubKeyParam] = Array(
    // COSE Algorithm: EdDSA
    WebAuthnCreationOptionsPubKeyParam(-8),
    // COSE Algorithm: ES256
    WebAuthnCreationOptionsPubKeyParam(-7),
    // COSE Algorithm: RS256
    WebAuthnCreationOptionsPubKeyParam(-257)
  )

  // The user handle stored in the passkey is the multiUser id. On login it identifies the account.
  def userHandle(multiUserId: ObjectId): Array[Byte] = multiUserId.toString.getBytes
}
