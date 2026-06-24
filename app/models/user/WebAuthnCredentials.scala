package models.user

import com.fasterxml.jackson.core.`type`.TypeReference
import com.fasterxml.jackson.annotation._
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.{JsonHelper, Fox}
import com.scalableminds.util.tools.Fox.toFox
import com.scalableminds.webknossos.schema.Tables.{
  Webauthncredentials,
  WebauthncredentialsRow,
  GetResultWebauthncredentialsRow
}
import com.webauthn4j.converter.AttestedCredentialDataConverter
import com.webauthn4j.converter.util.ObjectConverter
import com.webauthn4j.credential.{CredentialRecordImpl => WebAuthnCredentialRecord}
import com.webauthn4j.data.attestation.statement._
import com.webauthn4j.data.extension.authenticator.{
  AuthenticationExtensionsAuthenticatorOutputs,
  RegistrationExtensionAuthenticatorOutput
}
import com.scalableminds.util.box.Box.tryo
import utils.sql.{SQLDAO, SqlClient}
import play.api.libs.json._

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class WebAuthnCredential(
    _id: ObjectId,
    _multiUser: ObjectId,
    name: String,
    credentialRecord: WebAuthnCredentialRecord,
    isDeleted: Boolean
) {
  def serializeAttestedCredential(objectConverter: ObjectConverter): Array[Byte] = {
    val converter = new AttestedCredentialDataConverter(objectConverter);
    converter.convert(credentialRecord.getAttestedCredentialData)
  }

  def serializeAttestationStatement(objectConverter: ObjectConverter)(implicit ec: ExecutionContext): Fox[JsObject] = {
    val envelope = new AttestationStatementEnvelope()
    envelope.fmt = credentialRecord.getAttestationStatement.getFormat
    envelope.attestationStatement = credentialRecord.getAttestationStatement
    val rawJson = objectConverter.getJsonConverter.writeValueAsString(envelope)
    JsonHelper.parseAs[JsObject](rawJson).toFox
  }

  def serializedExtensions(converter: ObjectConverter)(implicit ec: ExecutionContext): Fox[JsObject] = {
    val rawJson = converter.getJsonConverter.writeValueAsString(credentialRecord.getAuthenticatorExtensions)
    JsonHelper.parseAs[JsObject](rawJson).toFox
  }
}

@JsonIgnoreProperties(ignoreUnknown = true)
class AttestationStatementEnvelope {

  @JsonProperty("fmt")
  var fmt: String = scala.compiletime.uninitialized

  @JsonProperty("attestationStatement")
  @JsonTypeInfo(use = JsonTypeInfo.Id.NAME, include = JsonTypeInfo.As.EXTERNAL_PROPERTY, property = "fmt")
  @JsonSubTypes(
    Array(
      new JsonSubTypes.Type(value = classOf[NoneAttestationStatement], name = "none"),
      new JsonSubTypes.Type(value = classOf[PackedAttestationStatement], name = "packed"),
      new JsonSubTypes.Type(value = classOf[AndroidKeyAttestationStatement], name = "android-key"),
      new JsonSubTypes.Type(value = classOf[AndroidSafetyNetAttestationStatement], name = "android-safetynet"),
      new JsonSubTypes.Type(value = classOf[AppleAnonymousAttestationStatement], name = "apple"),
      new JsonSubTypes.Type(value = classOf[FIDOU2FAttestationStatement], name = "fido-u2f"),
      new JsonSubTypes.Type(value = classOf[TPMAttestationStatement], name = "tpm")
    )
  )
  var attestationStatement: AttestationStatement = scala.compiletime.uninitialized

  def getFormat: String = fmt
  def getAttestationStatement: AttestationStatement = attestationStatement
}

class WebAuthnCredentialDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[WebAuthnCredential, WebauthncredentialsRow, Webauthncredentials](sqlClient) {
  protected val collection = Webauthncredentials
  protected def resultConverter = GetResultWebauthncredentialsRow

  protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] = {
    val objectConverter = new ObjectConverter()
    val converter = objectConverter.getJsonConverter
    val attestedCredentialDataConverter = new AttestedCredentialDataConverter(objectConverter)
    for {
      attestedCredential <- tryo(attestedCredentialDataConverter.convert(r.serializedattestedcredential)).toFox
      authenticatorExtensions <- tryo(
        converter.readValue(
          r.serializedextensions,
          new TypeReference[AuthenticationExtensionsAuthenticatorOutputs[RegistrationExtensionAuthenticatorOutput]] {}
        )
      ).toFox
      attestationStatement <- tryo(
        converter.readValue(r.serializedattestationstatement, new TypeReference[AttestationStatementEnvelope] {})
      ).toFox
      record = new WebAuthnCredentialRecord(
        attestationStatement.getAttestationStatement,
        r.userverified,
        r.backupeligible,
        r.backupstate,
        r.signaturecount.toLong,
        attestedCredential,
        authenticatorExtensions,
        null, // clientData - No client data is collected during registration.
        null, // clientExtensions - Client extensions are ignored.
        null // transports - All transport methods are allowed.
      )
    } yield WebAuthnCredential(ObjectId(r._Id), ObjectId(r._Multiuser), r.name, record, r.isdeleted)
  }

  def findAllForUser(multiUserId: ObjectId)(using ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _multiUser = $multiUserId AND $accessQuery"
          .as[WebauthncredentialsRow]
      )
      parsed <- parseAll(r)
    } yield parsed

  def findByCredentialId(multiUserId: ObjectId, credentialId: Array[Byte])(using
      ctx: DBAccessContext
  ): Fox[WebAuthnCredential] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM $existingCollectionName WHERE _multiUser = $multiUserId AND credentialId = $credentialId AND $accessQuery"
          .as[WebauthncredentialsRow]
      )
      parsed <- parseFirst(r, multiUserId)
    } yield parsed

  def insertOne(c: WebAuthnCredential): Fox[Unit] = {
    val converter = new ObjectConverter()
    val serializedAttestedCredential = c.serializeAttestedCredential(converter)
    val credentialId = c.credentialRecord.getAttestedCredentialData.getCredentialId
    val userVerified = c.credentialRecord.isUvInitialized.booleanValue
    val backupEligible = c.credentialRecord.isBackupEligible.booleanValue
    val backupState = c.credentialRecord.isBackedUp.booleanValue
    for {
      serializedAuthenticatorExtensions <- c.serializedExtensions(converter)
      serializedAttestationStatement <- c.serializeAttestationStatement(converter)
      _ <- run(
        q"""INSERT INTO $existingCollectionName (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState,
                                                 serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${credentialId}, ${c.name}, ${userVerified}, ${backupEligible}, ${backupState}, ${serializedAttestationStatement},
                         ${serializedAttestedCredential}, ${serializedAuthenticatorExtensions}, ${c.credentialRecord.getCounter.toInt})""".asUpdate
      )
    } yield ()
  }

  def updateSignCount(c: WebAuthnCredential): Fox[Unit] = {
    val signatureCount = c.credentialRecord.getCounter
    for {
      _ <- run(q"""UPDATE $existingCollectionName SET signatureCount = $signatureCount WHERE _id = ${c._id}""".asUpdate)
    } yield ()
  }

  def removeById(id: ObjectId, multiUser: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        q"""UPDATE $existingCollectionName SET isDeleted = true WHERE _id = ${id} AND _multiUser=${multiUser}""".asUpdate
      )
    } yield ()

}
