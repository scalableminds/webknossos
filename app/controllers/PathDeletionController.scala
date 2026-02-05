package controllers

import com.scalableminds.util.tools.Fox
import com.scalableminds.webknossos.datastore.helpers.UPath
import jakarta.inject.Inject
import models.dataset.{WKRemoteDataStoreClient}
import play.api.libs.json.Json
import play.api.mvc.{Action, AnyContent, PlayBodyParsers}
import utils.WkConf
import utils.sql.{SimpleSQLDAO, SqlClient, SqlToken}

import scala.concurrent.ExecutionContext

class PathDeletionController @Inject()(conf: WkConf, pathDeletionDAO: PathDeletionDAO)(implicit ec: ExecutionContext,
                                                                                       bodyParsers: PlayBodyParsers)
    extends Controller {

  def listPathsToDelete(key: String): Action[AnyContent] = Action.async { implicit request =>
    for {
      _ <- authenticateExternalPathDeletionService(key)
      paths <- pathDeletionDAO.findAll
    } yield Ok(Json.toJson(paths))
  }

  def markAsDeleted(key: String): Action[Seq[String]] = Action.async(validateJson[Seq[String]]) { implicit request =>
    for {
      _ <- authenticateExternalPathDeletionService(key)
      _ <- Fox.runIf(request.body.nonEmpty) {
        Fox.serialCombined(request.body.grouped(100))(pathDeletionDAO.markAsDeleted)
      }
    } yield Ok
  }

  private def authenticateExternalPathDeletionService(key: String): Fox[Unit] =
    Fox.fromBool(key == conf.ExternalPathDeletionService.key) ?~> "externalPathDeletionService.wrongKey"

}

class PathDeletionService @Inject()(pathDeletionDAO: PathDeletionDAO) {

  def deletePaths(datastoreClient: WKRemoteDataStoreClient, pathsToDelete: Seq[UPath]): Fox[Unit] =
    for {
      pathsToDeleteExternally <- datastoreClient.deletePaths(pathsToDelete)
      _ <- pathDeletionDAO.insertMultiple(pathsToDeleteExternally)
    } yield ()

}

class PathDeletionDAO @Inject()(sqlClient: SqlClient)(implicit ec: ExecutionContext) extends SimpleSQLDAO(sqlClient) {

  def findAll: Fox[Seq[String]] =
    run(q"""SELECT path from webknossos.remote_paths_to_delete ORDER BY created""".as[String])

  def insertMultiple(paths: Seq[UPath]): Fox[Unit] =
    for {
      _ <- run(q"""INSERT INTO webknossos.remote_paths_to_delete(path)
              VALUES ${SqlToken.joinByComma(paths.map(path => SqlToken.tupleFromList(Seq(path))))}
              ON CONFLICT DO NOTHING""".asUpdate)
    } yield ()

  def markAsDeleted(paths: Seq[String]): Fox[Unit] =
    for {
      _ <- run(
        q"""DELETE FROM webknossos.remote_paths_to_delete WHERE path in ${SqlToken.tupleFromList(paths)}""".asUpdate)
    } yield ()

}
