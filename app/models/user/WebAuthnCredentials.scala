package models.user

import com.fasterxml.jackson.core.`type`.TypeReference
import com.fasterxml.jackson.annotation.{JsonProperty, JsonCreator, JsonTypeInfo}
import com.fasterxml.jackson.annotation.JsonTypeInfo.Id
import com.scalableminds.util.accesscontext.DBAccessContext
import com.scalableminds.util.objectid.ObjectId
import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables._
import com.webauthn4j.converter.AttestedCredentialDataConverter
import com.webauthn4j.converter.util.ObjectConverter
import com.webauthn4j.credential.CredentialRecordImpl
import com.webauthn4j.data.attestation.authenticator.AttestedCredentialData
import com.webauthn4j.data.attestation.statement.AttestationStatement
import slick.lifted.Rep
import utils.sql.{SQLDAO, SqlClient}

import java.io.ByteArrayInputStream
import javax.inject.Inject
import scala.concurrent.ExecutionContext


case class WebAuthnCredential(
    _id: ObjectId,
    _multiUser: ObjectId,
    keyId: Array[Byte],
    name: String,
    publicKeyCose: Array[Byte],
    signatureCount: Int,
    isDeleted: Boolean,
)

// Define the AttestationStatementEnvelope class
case class AttestationStatementEnvelope(@JsonProperty("attStmt") attestationStatement: AttestationStatement) {
  // The JSON type information annotation for polymorphism
  @JsonTypeInfo(
    use = JsonTypeInfo.Id.NAME,
    include = JsonTypeInfo.As.EXTERNAL_PROPERTY,
    property = "fmt"
  )
  private val attStmt: AttestationStatement = attestationStatement

  // Getter for the 'fmt' property
  @JsonProperty("fmt")
  def getFormat: String = attestationStatement.getFormat

  // Getter for the AttestationStatement instance
  def getAttestationStatement: AttestationStatement = attestationStatement

  def serialize(converter: ObjectConverter): Array[Byte] =
    converter.getJsonConverter.writeValueAsBytes(this)
}

case class WebAuthnCredential2(
    _id: ObjectId,
    _multiUser: ObjectId,
    name: String,
    record: CredentialRecordImpl,
    isDeleted: Boolean,
) {
}

class WebAuthnCredentialDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext)
    extends SQLDAO[WebAuthnCredential, WebauthncredentialsRow, Webauthncredentials](sqlClient) {
  protected val collection = Webauthncredentials

  override protected def idColumn(x: Webauthncredentials): Rep[String] = x._Id

  override protected def isDeletedColumn(x: Webauthncredentials): Rep[Boolean] = x.isdeleted

  protected def parse(r: WebauthncredentialsRow): Fox[WebAuthnCredential] =
    Fox.successful(
      WebAuthnCredential(
        ObjectId(r._Id),
        ObjectId(r._Multiuser),
        r.keyid,
        r.name,
        r.publickeycose,
        r.signaturecount,
        r.isdeleted
      )
    )

  def findAllForUser(userId: ObjectId)(implicit ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM webknossos.webauthncredentials WHERE _multiUser = $userId AND $accessQuery"
          .as[WebauthncredentialsRow])
      parsed <- parseAll(r)
    } yield parsed

  def listByKeyId(id: Array[Byte])(implicit ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM webknossos.webauthncredentials WHERE keyId = $id AND $accessQuery"
          .as[WebauthncredentialsRow])
      parsed <- parseAll(r)
    } yield parsed

  def findByKeyIdAndUserId(id: Array[Byte], userId: ObjectId)(implicit ctx: DBAccessContext): Fox[WebAuthnCredential] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"SELECT $columns FROM webknossos.webauthncredentials WHERE keyId = $id AND _multiUser = $userId AND $accessQuery"
          .as[WebauthncredentialsRow])
      parsed <- parseAll(r)
      first <- Fox.option2Fox(parsed.headOption)
    } yield first

  def insertOne(c: WebAuthnCredential): Fox[Unit] =
    for {
      _ <- run(
        q"""INSERT INTO webknossos.webauthncredentials(_id, _multiUser, keyId, name, publicKeyCose, signatureCount)
                       VALUES(${c._id}, ${c._multiUser}, ${c.keyId}, ${c.name},
                              ${c.publicKeyCose}, ${c.signatureCount})""".asUpdate)
    } yield ()

  def insertOne2(c: WebAuthnCredential2): Fox[Unit] = {
    for {
      _ <- run(
        q"""INSERT INTO webknossos.webauthncredentials(_id, _multiUser, keyId, name) VALUES ()""".asUpdate // TODO
      )
    } yield ()
  }


  def listKeys(multiUser: ObjectId)(implicit ctx: DBAccessContext): Fox[List[WebAuthnCredential]] =
    for {
      accessQuery <- readAccessQuery
      r <- run(
        q"""SELECT $columns FROM webknossos.webauthncredentials WHERE _multiUser = $multiUser AND $accessQuery"""
          .as[WebauthncredentialsRow])
      parsed <- parseAll(r)
    } yield parsed

  def removeById(id: ObjectId, multiUser: ObjectId): Fox[Unit] =
    for {
      _ <- run(q"""DELETE FROM webknossos.webauthncredentials WHERE _id = ${id} AND _multiUser=${multiUser}""".asUpdate)
    } yield ()

}
