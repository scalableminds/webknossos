package models.dataset

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.UPath
import jakarta.inject.Inject
import utils.sql.{SimpleSQLDAO, SqlClient, SqlToken}

import scala.concurrent.ExecutionContext

// Paths in managed S3 cannot be deleted synchronously. They are queued in the db
// and periodically fetched and deleted by the datastores (see ManagedS3PathDeletionService there)
class PathDeletionService @Inject() (pathDeletionDAO: PathDeletionDAO) {

  def deletePaths(datastoreClient: WKRemoteDataStoreClient, pathsToDelete: Seq[UPath]): Fox[Unit] =
    for {
      filtered = pathsToDelete.filter(_.toZipEntryUPath.isEmpty) // Cannot delete paths that reference ZipEntries
      pathsToDeleteExternally <- datastoreClient.deletePaths(filtered)
      _ <- pathDeletionDAO.insertMultiple(pathsToDeleteExternally)
    } yield ()

}

class PathDeletionDAO @Inject() (sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def findAll: Fox[Seq[String]] =
    run(q"""SELECT path from webknossos.remote_paths_to_delete ORDER BY created""".as[String])

  def insertMultiple(paths: Seq[UPath]): Fox[Unit] =
    if (paths.isEmpty) Fox.successful(())
    else
      for {
        _ <- run(q"""INSERT INTO webknossos.remote_paths_to_delete(path)
              VALUES ${SqlToken.joinByComma(paths.map(path => SqlToken.tupleFromList(Seq(path))))}
              ON CONFLICT DO NOTHING""".asUpdate)
      } yield ()

  def markAsDeleted(paths: Seq[String]): Fox[Unit] =
    if (paths.isEmpty) Fox.successful(())
    else
      for {
        _ <- run(
          q"""DELETE FROM webknossos.remote_paths_to_delete WHERE path in ${SqlToken.tupleFromList(paths)}""".asUpdate
        )
      } yield ()

}
