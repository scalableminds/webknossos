package models.folder

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Folders, _}
import play.api.libs.json.{JsObject, Json}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import slick.sql.SqlAction
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Folder(_id: ObjectId, name: String)

class FolderService @Inject()()(implicit ec: ExecutionContext) {
  def publicWrites(folder: Folder): Fox[JsObject] =
    Fox.successful(Json.obj("id" -> folder._id, "name" -> folder.name))
}

class FolderDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
    extends SQLDAO[Folder, FoldersRow, Folders](sqlClient) {

  val collection = Folders
  def idColumn(x: Folders): Rep[String] = x._Id
  def isDeletedColumn(x: Folders): Rep[Boolean] = x.isdeleted

  def parse(r: FoldersRow): Fox[Folder] =
    Fox.successful(Folder(ObjectId(r._Id), r.name))

  def insertAsRoot(f: Folder): Fox[Unit] = {
    val insertPathQuery =
      sqlu"INSERT INTO webknossos.folder_paths(_ancestor, _descendant, depth) VALUES(${f._id}, ${f._id}, 0)"
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)).transactionally)
    } yield ()
  }

  def findOne(folderId: ObjectId): Fox[Folder] =
    for {
      rows <- run(sql"SELECT #$columns FROM webknossos.folders WHERE _id = $folderId".as[FoldersRow])
      parsed <- parseFirst(rows, "id")
    } yield parsed

  def findChildren(folderId: ObjectId): Fox[List[Folder]] =
    for {
      rows <- run(sql"SELECT #$columns".as[FoldersRow]) // TODO
      parsed <- parseAll(rows)
    } yield parsed

  def insertAsChild(parentId: ObjectId, f: Folder): Fox[Unit] = {
    val insertPathQuery =
      sqlu"""INSERT INTO webknossos.folder_paths(_ancestor, descendant, depth)
             SELECT ancestor, ${f._id}, depth + 1 from webknossos.folder_paths WHERE descendant = $parentId -- links to ancestors
             UNION ALL SELECT ${f._id}, ${f._id}, 0 -- self link
          """
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery(f), insertPathQuery)))
    } yield ()
  }

  private def insertFolderQuery(f: Folder): SqlAction[Int, NoStream, Effect] =
    sqlu"insert into webknossos.folders(_id, name) values (${f._id}, ${f.name})"

  def updateOne(f: Folder): Fox[Unit] =
    for {
      _ <- run(sqlu"update webknossos.folders set name = ${f.name} where _id = ${f._id}")
    } yield ()

// TODO  mkdir -p route

  // set permissions for folder
  // load full tree (sans datasets)
  // enforce unique names per layer
  // Root per organization!
}
