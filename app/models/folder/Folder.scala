package models.folder

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.schema.Tables.{Folders, _}
import slick.jdbc.PostgresProfile.api._
import slick.lifted.Rep
import utils.{ObjectId, SQLClient, SQLDAO}

import javax.inject.Inject
import scala.concurrent.ExecutionContext

case class Folder(_id: ObjectId, name: String)

class FolderDAO @Inject()(sqlClient: SQLClient)(implicit ec: ExecutionContext)
  extends SQLDAO[Folder, FoldersRow, Folders](sqlClient) {

  val collection = Folders
  def idColumn(x: Folders): Rep[String] = x._Id
  def isDeletedColumn(x: Folders): Rep[Boolean] = x.isdeleted

  def parse(r: FoldersRow): Fox[Folder] =
    Fox.successful(Folder(ObjectId(r._Id), r.name))

  def insertRoot(): Fox[Unit] = {
    val id = ObjectId.generate
    val name = "root"
    val insertFolderQuery = sqlu"insert into webknossos.folders(_id, name) values($id, $name)"
    val insertPathQuery = sqlu"insert into webknossos.folder_paths(_ancestor, _descendant, depth) values($id, $id, 0)"
    for {
      _ <- run(DBIO.sequence(List(insertFolderQuery, insertPathQuery)).transactionally)
    } yield ()
  }

  def getRoot: Fox[Folder] = {
    for {
      row <-
        run(sql"""
             SELECT _id, name FROM webknossos.folders
             WHERE NOT EXISTS ( SELECT TOP 1 1 descendant FROM webknossos.folder_paths WHERE depth > 0)""".as[FoldersRow])
      parsed <- parseFirst(row, "root")
    } yield parsed
  }

}
