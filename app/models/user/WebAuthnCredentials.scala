package models.user

import tools.jackson.core.`type`.TypeReference
import com.fasterxml.jackson.annotation.*
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
import com.webauthn4j.credential.CredentialRecordImpl as WebAuthnCredentialRecord
import com.webauthn4j.data.attestation.statement.*
import com.webauthn4j.data.extension.authenticator.{
  AuthenticationExtensionsAuthenticatorOutputs,
  RegistrationExtensionAuthenticatorOutput
}
import com.scalableminds.util.box.Box
import com.scalableminds.util.box.Box.tryo
import utils.sql.{SQLDAO, SqlClient}
import play.api.libs.json.*

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class WebAuthnCredential(
    _id: ObjectId,
    _multiUser: ObjectId,
    name: String,
    credentialRecord: WebAuthnCredentialRecord,
    isDeleted: Boolean
)

// The parts of a credential record that are stored in the database, see webknossos.webauthnCredentials.
case class SerializedWebAuthnCredentialRecord(
    credentialId: Array[Byte],
    userVerified: Boolean,
    backupEligible: Boolean,
    backupState: Boolean,
    attestationStatement: JsObject,
    attestedCredential: Array[Byte],
    extensions: JsObject,
    signatureCount: Long
)

object SerializedWebAuthnCredentialRecord {

  def serialize(record: WebAuthnCredentialRecord): Box[SerializedWebAuthnCredentialRecord] = {
    val objectConverter = new ObjectConverter()
    val jsonMapper = objectConverter.getJsonMapper
    val envelope = new AttestationStatementEnvelope()
    envelope.fmt = record.getAttestationStatement.getFormat
    envelope.attestationStatement = record.getAttestationStatement
    for {
      attestationStatement <- JsonHelper.parseAs[JsObject](jsonMapper.writeValueAsString(envelope))
      extensions <- JsonHelper.parseAs[JsObject](jsonMapper.writeValueAsString(record.getAuthenticatorExtensions))
      attestedCredential <- tryo(
        new AttestedCredentialDataConverter(objectConverter).convert(record.getAttestedCredentialData)
      )
    } yield SerializedWebAuthnCredentialRecord(
      credentialId = record.getAttestedCredentialData.getCredentialId,
      userVerified = record.isUvInitialized.booleanValue,
      backupEligible = record.isBackupEligible.booleanValue,
      backupState = record.isBackedUp.booleanValue,
      attestationStatement = attestationStatement,
      attestedCredential = attestedCredential,
      extensions = extensions,
      signatureCount = record.getCounter
    )
  }

  def deserialize(
      attestationStatementJson: String,
      attestedCredential: Array[Byte],
      extensionsJson: String,
      userVerified: Boolean,
      backupEligible: Boolean,
      backupState: Boolean,
      signatureCount: Long
  ): Box[WebAuthnCredentialRecord] = {
    val objectConverter = new ObjectConverter()
    val jsonMapper = objectConverter.getJsonMapper
    for {
      attestedCredentialData <- tryo(new AttestedCredentialDataConverter(objectConverter).convert(attestedCredential))
      authenticatorExtensions <- tryo(
        jsonMapper.readValue(
          extensionsJson,
          new TypeReference[AuthenticationExtensionsAuthenticatorOutputs[RegistrationExtensionAuthenticatorOutput]] {}
        )
      )
      attestationStatement <- tryo(
        jsonMapper.readValue(attestationStatementJson, new TypeReference[AttestationStatementEnvelope] {})
      )
    } yield new WebAuthnCredentialRecord(
      attestationStatement.getAttestationStatement,
      userVerified,
      backupEligible,
      backupState,
      signatureCount,
      attestedCredentialData,
      authenticatorExtensions,
      null, // clientData - No client data is collected during registration.
      null, // clientExtensions - Client extensions are ignored.
      null // transports - All transport methods are allowed.
    )
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

  protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] =
    for {
      record <- SerializedWebAuthnCredentialRecord
        .deserialize(
          attestationStatementJson = r.serializedattestationstatement,
          attestedCredential = r.serializedattestedcredential,
          extensionsJson = r.serializedextensions,
          userVerified = r.userverified,
          backupEligible = r.backupeligible,
          backupState = r.backupstate,
          signatureCount = r.signaturecount.toLong
        )
        .toFox
    } yield WebAuthnCredential(ObjectId(r._id), ObjectId(r._multiuser), r.name, record, r.isdeleted)

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

  def insertOne(c: WebAuthnCredential): Fox[Unit] =
    for {
      s <- SerializedWebAuthnCredentialRecord.serialize(c.credentialRecord).toFox
      _ <- run(
        q"""INSERT INTO $existingCollectionName (_id, _multiUser, credentialId, name, userVerified, backupEligible, backupState,
                                                 serializedAttestationStatement, serializedAttestedCredential, serializedExtensions, signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${s.credentialId}, ${c.name}, ${s.userVerified}, ${s.backupEligible}, ${s.backupState}, ${s.attestationStatement},
                         ${s.attestedCredential}, ${s.extensions}, ${s.signatureCount.toInt})""".asUpdate
      )
    } yield ()

  def updateSignCount(c: WebAuthnCredential): Fox[Unit] = {
    val signatureCount = c.credentialRecord.getCounter
    for {
      _ <- run(q"""UPDATE $existingCollectionName SET signatureCount = $signatureCount WHERE _id = ${c._id}""".asUpdate)
    } yield ()
  }

  def removeById(id: ObjectId, multiUser: ObjectId): Fox[Unit] =
    for {
      _ <- run(
        q"""UPDATE $existingCollectionName SET isDeleted = true WHERE _id = $id AND _multiUser=$multiUser""".asUpdate
      )
    } yield ()

}
