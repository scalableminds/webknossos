package models.user

import com.fasterxml.jackson.core.`type`.TypeReference
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.webauthn4j.converter.AttestedCredentialDataConverter
import com.webauthn4j.converter.util.ObjectConverter
import com.webauthn4j.credential.CredentialRecordImpl
import com.webauthn4j.data.attestation.statement.NoneAttestationStatement
import com.webauthn4j.data.extension.authenticator.{AuthenticationExtensionsAuthenticatorOutputs, RegistrationExtensionAuthenticatorOutput}
import net.liftweb.common.Box.tryo
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient}

import javax.inject.Inject
import scala.concurrent.ExecutionContext


case class WebAuthnCredential(
    _id: ObjectId,
    _multiUser: ObjectId,
    name: String,
    credentialRecord: CredentialRecordImpl,
    isDeleted: Boolean,
) {
  def serializeAttestedCredential(objectConverter: ObjectConverter): Array[Byte] = {
    val converter = new AttestedCredentialDataConverter(objectConverter);
    converter.convert(credentialRecord.getAttestedCredentialData)
  }

  def serializedExtensions(converter: ObjectConverter): String = {
    converter.getJsonConverter.writeValueAsString(credentialRecord.getAuthenticatorExtensions)
  }
}

class WebAuthnCredentialDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[WebAuthnCredential, WebauthncredentialsRow, Webauthncredentials](sqlClient) {
  protected val collection = Webauthncredentials

  override protected def idColumn(x: Webauthncredentials): Rep[String] = x._Id

  override protected def isDeletedColumn(x: Webauthncredentials): Rep[Boolean] = x.isdeleted

  protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] = {
    val objectConverter = new ObjectConverter()
    val converter = objectConverter.getJsonConverter
    val attestedCredentialDataConverter = new AttestedCredentialDataConverter(objectConverter)
    for {
      attestedCredential <- tryo(attestedCredentialDataConverter.convert(r.serializedattestedcredential)).toFox
      authenticatorExtensions <- tryo(converter.readValue(r.serializedextensions, new TypeReference[AuthenticationExtensionsAuthenticatorOutputs[RegistrationExtensionAuthenticatorOutput]] {})).toFox
      record = new CredentialRecordImpl(
        new NoneAttestationStatement(),
        null,
        null,
        null,
        r.signaturecount.toLong,
        attestedCredential,
        authenticatorExtensions,
        null,
        null,
        null
      )
    } yield WebAuthnCredential(ObjectId(r._Id), ObjectId(r._Multiuser), r.name, record, r.isdeleted)
  }

  def findAllForUser(multiUserId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM webknossos.webauthncredentials WHERE _multiUser = $multiUserId AND $accessQuery"
          .as[WebauthncredentialsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findByCredentialId(multiUserId: ObjectId, credentialId: Array[Byte])(implicit ctx: DBAccessContext): Fox[WebAuthnCredential] =
    for {
      accessQuery <- readAccessQuery
      r <- run(q"SELECT $columns FROM webknossos.webauthncredentials WHERE _multiUser = $multiUserId AND credentialId = $credentialId AND $accessQuery"
          .as[WebauthncredentialsRow])
      parsed <- parseFirst(r, multiUserId)
    } yield parsed

  def insertOne(c: WebAuthnCredential): Fox[Unit] = {
    val converter = new ObjectConverter()
    val serializedAttestedCredential = c.serializeAttestedCredential(converter)
    print(serializedAttestedCredential)
    val serializedAuthenticatorExtensions = c.serializedExtensions(converter)
    print(serializedAuthenticatorExtensions)
    val credentialId = c.credentialRecord.getAttestedCredentialData.getCredentialId
    for {
      _ <- run(
        q"""INSERT INTO webknossos.webauthncredentials(_id, _multiUser, credentialId, name, serializedAttestedCredential, serializedExtensions, signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${credentialId}, ${c.name}, ${serializedAttestedCredential},
                              ${serializedAuthenticatorExtensions}, ${c.credentialRecord.getCounter.toInt})""".asUpdate)
    } yield ()
  }

  def updateSignCount(c: WebAuthnCredential): Fox[Unit] = {
    val signatureCount = c.credentialRecord.getCounter
    for {
      _ <- run(q"""UPDATE webknossos.webauthncredentials SET signatureCount = $signatureCount WHERE _id = ${c._id}""".asUpdate)
    } yield ()
  }

  def removeById(id: ObjectId, multiUser: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.webauthncredentials WHERE _id = ${id} AND _multiUser=${multiUser}""".asUpdate)
    } yield ()

}
