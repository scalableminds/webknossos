package models.binary.credential

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{AnyCredential, HttpBasicAuthCredential, S3AccessKeyCredential}
import com.scalableminds.webknossos.schema.Tables
import com.scalableminds.webknossos.schema.Tables.{Credentials, CredentialsRow}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

// Generic credential as it appears in the database
case class Credential(_id: ObjectId,
                      credentialType: CredentialType.Value,
                      name: String,
                      identifier: Option[String],
                      secret: Option[String],
                      scope: Option[String],
                      filePath: Option[String])

class CredentialDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Credential, CredentialsRow, Credentials](sqlClient) {
  val collection = Credentials

  def idColumn(x: Credentials): Rep[String] = x._Id
  override def isDeletedColumn(x: Tables.Credentials): Rep[Boolean] = false

  // use parseAnyCredential instead
  def parse(row: com.scalableminds.webknossos.schema.Tables.Credentials#TableElementType)
    : com.scalableminds.util.tools.Fox[models.binary.credential.Credential] = ???

  def parseAsHttpBasicAuthCredential(r: CredentialsRow): Fox[HttpBasicAuthCredential] =
    for {
      username <- r.identifier.toFox
      password <- r.secret.toFox
      domain = r.scope
    } yield
      HttpBasicAuthCredential(
        r.name,
        username,
        password,
        domain
      )

  def parseAsS3AccessKeyCredential(r: CredentialsRow): Fox[S3AccessKeyCredential] =
    for {
      keyId <- r.identifier.toFox
      key <- r.secret.toFox
      bucket = r.scope
    } yield
      S3AccessKeyCredential(
        r.name,
        keyId,
        key,
        bucket
      )

  def insertOne(_id: ObjectId, credential: HttpBasicAuthCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, type, name, identifier, secret, scope)
                     values(${_id}, '#${CredentialType.HTTP_Basic_Auth}', ${credential.name}, ${credential.username}, ${credential.password}, ${credential.domain})""")
    } yield ()

  def insertOne(_id: ObjectId, credential: S3AccessKeyCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, type, name, identifier, secret, scope)
                     values(${_id}, '#${CredentialType.S3_Access_Key}', ${credential.name}, ${credential.keyId}, ${credential.key}, ${credential.bucket})""")
    } yield ()

  def findOne(id: ObjectId): Fox[AnyCredential] =
    for {
      r <- run(sql"select #$columns from webknossos.credentials where _id = $id".as[CredentialsRow])
      firstRow <- r.headOption.toFox
      parsed <- parseAnyCredential(firstRow)
    } yield parsed

  def parseAnyCredential(r: CredentialsRow): Fox[AnyCredential] =
    r.`type` match {
      case "HTTP_Basic_Auth" =>
        for {
          parsed <- parseAsHttpBasicAuthCredential(r)
        } yield parsed
      case "S3_Access_Key" =>
        for {
          parsed <- parseAsS3AccessKeyCredential(r)
        } yield parsed
    }
}
