package models.dataset.credential

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{
  DataVaultCredential,
  GoogleServiceAccountCredential,
  HttpBasicAuthCredential,
  S3AccessKeyCredential
}
import com.scalableminds.webknossos.schema.Tables.{Credentials, CredentialsRow}
import com.scalableminds.util.tools.Box.tryo
import play.api.libs.json.Json
import utils.sql.{SecuredSQLDAO, SqlClient, SqlToken}
import com.scalableminds.util.objectid.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CredentialDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SecuredSQLDAO(sqlClient) {
  protected val collection = Credentials

  protected def columnsList: List[String] = collection.baseTableRow.create_*.map(_.name).toList
  override protected def collectionName: String = "credentials"
  def columns: SqlToken = SqlToken.raw(columnsList.mkString(", "))

  private def parseAsHttpBasicAuthCredential(r: CredentialsRow): Fox[HttpBasicAuthCredential] =
    for {
      username <- r.identifier.toFox
      password <- r.secret.toFox
    } yield
      HttpBasicAuthCredential(
        r.name,
        username,
        password,
        r._User,
        r._Organization
      )

  private def parseAsS3AccessKeyCredential(r: CredentialsRow): Fox[S3AccessKeyCredential] =
    for {
      keyId <- r.identifier.toFox
      key <- r.secret.toFox
    } yield
      S3AccessKeyCredential(
        r.name,
        keyId,
        key,
        r._User,
        r._Organization
      )

  private def parseAsGoogleServiceAccountCredential(r: CredentialsRow): Fox[GoogleServiceAccountCredential] =
    for {
      secret <- r.secret.toFox
      secretJson <- tryo(Json.parse(secret)).toFox
    } yield
      GoogleServiceAccountCredential(
        r.name,
        secretJson,
        r._User,
        r._Organization
      )

  def insertOne(_id: ObjectId, credential: HttpBasicAuthCredential): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.credentials(_id, type, name, identifier, secret, _user, _organization)
                   VALUES(${_id}, ${CredentialType.HttpBasicAuth}, ${credential.name}, ${credential.username}, ${credential.password}, ${credential.user}, ${credential.organization})""".asUpdate)
    } yield ()

  def insertOne(_id: ObjectId, credential: S3AccessKeyCredential): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.credentials(_id, type, name, identifier, secret, _user, _organization)
                   VALUES(${_id}, ${CredentialType.S3AccessKey}, ${credential.name}, ${credential.accessKeyId}, ${credential.secretAccessKey}, ${credential.user}, ${credential.organization})""".asUpdate)
    } yield ()

  def insertOne(_id: ObjectId, credential: GoogleServiceAccountCredential): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.credentials(_id, type, name, secret, _user, _organization)
                   VALUES(${_id}, ${CredentialType.GoogleServiceAccount}, ${credential.name}, ${credential.secretJson.toString}, ${credential.user}, ${credential.organization})""".asUpdate)
    } yield ()

  def findOne(id: ObjectId): Fox[DataVaultCredential] =
    for {
      r <- run(q"SELECT $columns FROM webknossos.credentials_ WHERE _id = $id".as[CredentialsRow])
      firstRow <- r.headOption.toFox
      parsed <- parseAnyCredential(firstRow)
    } yield parsed

  private def parseAnyCredential(r: CredentialsRow): Fox[DataVaultCredential] =
    for {
      typeParsed <- CredentialType.fromString(r.`type`).toFox
      parsed <- typeParsed match {
        case CredentialType.HttpBasicAuth        => parseAsHttpBasicAuthCredential(r)
        case CredentialType.S3AccessKey          => parseAsS3AccessKeyCredential(r)
        case CredentialType.GoogleServiceAccount => parseAsGoogleServiceAccountCredential(r)
        case _                                   => Fox.failure(s"Unknown credential type: ${r.`type`}")
      }
    } yield parsed
}
