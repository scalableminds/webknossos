package models.binary.credential

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.storage.{AnyCredential, HttpBasicAuthCredential, S3AccessKeyCredential}
import com.scalableminds.webknossos.schema.Tables.{Credentials, CredentialsRow}
import slick.jdbc.PostgresProfile.api._
import utils.sql.{SecuredSQLDAO, SQLClient}
import utils.ObjectId

import javax.inject.Inject
import scala.concurrent.ExecutionContext

class CredentialDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext) extends SecuredSQLDAO(sqlClient) {
  protected val collection = Credentials

  protected def columnsList: List[String] = collection.baseTableRow.create_*.map(_.name).toList
  override protected def collectionName: String = "credentials"
  def columns: String = columnsList.mkString(", ")

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

  def insertOne(_id: ObjectId, credential: HttpBasicAuthCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, type, name, identifier, secret, _user, _organization)
                     values(${_id}, '#${CredentialType.HTTP_Basic_Auth}', ${credential.name}, ${credential.username}, ${credential.password}, ${credential.user}, ${credential.organization})""")
    } yield ()

  def insertOne(_id: ObjectId, credential: S3AccessKeyCredential): Fox[Unit] =
    for {
      _ <- run(sqlu"""insert into webknossos.credentials(_id, type, name, identifier, secret, _user, _organization)
                     values(${_id}, '#${CredentialType.S3_Access_Key}', ${credential.name}, ${credential.keyId}, ${credential.key}, ${credential.user}, ${credential.organization})""")
    } yield ()

  def findOne(id: ObjectId): Fox[AnyCredential] =
    for {
      r <- run(sql"select #$columns from webknossos.credentials_ where _id = $id".as[CredentialsRow])
      firstRow <- r.headOption.toFox
      parsed <- parseAnyCredential(firstRow)
    } yield parsed

  private def parseAnyCredential(r: CredentialsRow): Fox[AnyCredential] =
    r.`type` match {
      case "HTTP_Basic_Auth" => parseAsHttpBasicAuthCredential(r)
      case "S3_Access_Key"   => parseAsS3AccessKeyCredential(r)
    }
}
