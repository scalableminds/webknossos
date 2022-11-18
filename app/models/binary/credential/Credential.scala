package models.binary.credential

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables
import utils.{ObjectId, SQLClient, SQLDAO}
import com.scalableminds.webknossos.schema.Tables.{Credentials, CredentialsRow}
import play.api.libs.json.{Json, OFormat}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep

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

// Specific credentials
sealed trait AnyCredential

object AnyCredential {
  implicit val jsonFormat: OFormat[AnyCredential] = Json.format[AnyCredential]
}

case class HttpBasicAuthCredential(_id: ObjectId, name: String, username: String, password: String, domain: String)
    extends AnyCredential

case class S3AccessKeyCredential(_id: ObjectId, name: String, keyId: String, key: String, bucket: String)
    extends AnyCredential

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
      domain <- r.scope.toFox
    } yield
      HttpBasicAuthCredential(
        ObjectId(r._Id),
        r.name,
        username,
        password,
        domain
      )

  def parseAsS3AccessKeyCredential(r: CredentialsRow): Fox[S3AccessKeyCredential] =
    for {
      keyId <- r.identifier.toFox
      key <- r.secret.toFox
      bucket <- r.scope.toFox
    } yield
      S3AccessKeyCredential(
        ObjectId(r._Id),
        r.name,
        keyId,
        key,
        bucket
      )

  def insertOne(credential: HttpBasicAuthCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, credentialType, name, identifier, secret, scope)
                     values(${credential._id}, '#${CredentialType.HTTP_Basic_Auth}', ${credential.name}, ${credential.username}, ${credential.password}, ${credential.domain})""")
    } yield ()

  def insertOne(credential: S3AccessKeyCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, credentialType, name, identifier, secret, scope)
                     values(${credential._id}, '#${CredentialType.S3_Access_Key}', ${credential.name}, ${credential.keyId}, ${credential.key}, ${credential.bucket})""")
    } yield ()

  def findOne(id: ObjectId): Fox[AnyCredential] =
    for {
      r <- run(sql"select #$columns from webknossos.credentials where id = $id".as[CredentialsRow])
      firstRow <- r.headOption.toFox
      parsed <- parseAnyCredential(firstRow)
    } yield parsed

  def parseAnyCredential(r: CredentialsRow): Fox[AnyCredential] =
    r.`type` match {
      case "HTTP Basic-Auth" =>
        for {
          parsed <- parseAsHttpBasicAuthCredential(r)
        } yield parsed
      case "S3 Access Key" =>
        for {
          parsed <- parseAsS3AccessKeyCredential(r)
        } yield parsed
    }
}
