package security

import com.scalableminds.util.objectid.ObjectId
import com.webauthn4j.data.client.challenge.Challenge
import play.api.libs.json.{JsValue, Json, OFormat}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions
  *
  * Omitted:
  *   - `attestation` and `attestationFormat`, because attestation is not implemented.
  *   - `extensions` no extensions in use.
  */
case class WebAuthnPublicKeyCredentialCreationOptions(
    authenticatorSelection: WebAuthnCreationOptionsAuthenticatorSelection,
    attestation: String = "none",
    challenge: String,
    excludeCredentials: Array[WebAuthnCreationOptionsExcludeCredentials],
    pubKeyCredParams: Array[WebAuthnCreationOptionsPubKeyParam],
    timeout: Int, // timeout in milliseconds
    rp: WebAuthnCreationOptionsRelyingParty,
    user: WebAuthnCreationOptionsUser
)
object WebAuthnPublicKeyCredentialCreationOptions {
  implicit val jsonFormat: OFormat[WebAuthnPublicKeyCredentialCreationOptions] =
    Json.format[WebAuthnPublicKeyCredentialCreationOptions]
}

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#authenticatorselection
  *
  * Omitted:
  *   - `authenticatorAttachment` no forced authenticator.
  *   - `userVerifiaction` not implemented on our side.
  *   - `hints` no restrictions.
  */
case class WebAuthnCreationOptionsAuthenticatorSelection(
    requireResidentKey: Boolean = true,
    residentKey: String = "required",
    userVerification: String = "preferred"
)
object WebAuthnCreationOptionsAuthenticatorSelection {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsAuthenticatorSelection] =
    Json.format[WebAuthnCreationOptionsAuthenticatorSelection]
}

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#excludecredentials
  *
  * Omitted:
  *   - `transports` not restricted by us.
  */
case class WebAuthnCreationOptionsExcludeCredentials(
    id: String,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsExcludeCredentials {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsExcludeCredentials] =
    Json.format[WebAuthnCreationOptionsExcludeCredentials]
}

/** Object reference:
  * https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#pubkeycredparams
  */
case class WebAuthnCreationOptionsPubKeyParam(
    alg: Int,
    `type`: String = "public-key" // must be set to "public-key"
)
object WebAuthnCreationOptionsPubKeyParam {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsPubKeyParam] = Json.format[WebAuthnCreationOptionsPubKeyParam]
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#rp
  */
case class WebAuthnCreationOptionsRelyingParty(
    id: String, // Should be set to the hostname
    name: String
)
object WebAuthnCreationOptionsRelyingParty {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsRelyingParty] =
    Json.format[WebAuthnCreationOptionsRelyingParty]
}

case class WebAuthnChallenge(data: Array[Byte]) extends Challenge {
  def getValue: Array[Byte] = data
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialCreationOptions#user
  */
case class WebAuthnCreationOptionsUser(
    displayName: String,
    id: String,
    name: String
)
object WebAuthnCreationOptionsUser {
  implicit val jsonFormat: OFormat[WebAuthnCreationOptionsUser] = Json.format[WebAuthnCreationOptionsUser]
}

/** Object reference: https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredentialRequestOptions
  *
  * Omitted:
  *   - allowCredentials: Not necessary, because we use client discoverable credentials
  *   - extensions: Not used
  */
case class WebAuthnPublicKeyCredentialRequestOptions(
    challenge: String,
    timeout: Option[Long] = None, // In milliseconds
    rpId: Option[String] = None, // Relying party ID
    userVerification: Option[String] = Some("preferred"), // "required", "preferred", "discouraged"
    hints: Option[Seq[String]] = None // UI hints for the user-agent
)
object WebAuthnPublicKeyCredentialRequestOptions {
  implicit val jsonFormat: OFormat[WebAuthnPublicKeyCredentialRequestOptions] =
    Json.format[WebAuthnPublicKeyCredentialRequestOptions]
}

/** Custom carrier object. Contains name of the key to register and a key instance of PublicKeyCredentialType
  * (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnRegistration(name: String, key: JsValue)
object WebAuthnRegistration {
  implicit val jsonFormat: OFormat[WebAuthnRegistration] = Json.format[WebAuthnRegistration]
}

/** Wrapper of PublicKeyCredential (https://developer.mozilla.org/en-US/docs/Web/API/PublicKeyCredential).
  */
case class WebAuthnAuthentication(key: JsValue)
object WebAuthnAuthentication {
  implicit val jsonFormat: OFormat[WebAuthnAuthentication] = Json.format[WebAuthnAuthentication]
}

/** Custom object for WebAuthnCredential's id and name.
  */
case class WebAuthnKeyDescriptor(id: ObjectId, name: String)
object WebAuthnKeyDescriptor {
  implicit val jsonFormat: OFormat[WebAuthnKeyDescriptor] = Json.format[WebAuthnKeyDescriptor]
}
