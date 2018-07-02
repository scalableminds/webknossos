import akka.actor.Props
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Mailer
import com.scalableminds.util.reactivemongo.GlobalAccessContext
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import models.annotation.AnnotationSQLDAO
import net.liftweb.common.{Failure, Full}
import oxalis.cleanup.CleanUpService
import oxalis.security.WebknossosSilhouette
import play.api._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.concurrent._
import play.api.mvc.Results.Ok
import play.api.mvc._
import utils.SQLClient

import scala.concurrent.Future
import sys.process._
import scala.concurrent.duration._

object Global extends GlobalSettings with LazyLogging{

  override def onStart(app: Application) {
    val conf = app.configuration

    logger.info("Executing Global START")
    startActors(conf.underlying, app)

    ensurePostgresDatabase.onComplete { _ =>
      if (conf.getBoolean("application.insertInitialData") getOrElse false) {
        InitialDataService.insert.futureBox.map {
          case Full(_) => ()
          case Failure(msg, _, _) => logger.warn("No initial data inserted: " + msg)
          case _ => logger.warn("Error while inserting initial data")
        }
      }
    }

    val tokenAuthenticatorService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

    CleanUpService.register("deletion of expired tokens", tokenAuthenticatorService.dataStoreExpiry) {
      tokenAuthenticatorService.removeExpiredTokens(GlobalAccessContext)
    }

    CleanUpService.register("deletion of old annotations in initializing state", 1 day) {
      AnnotationSQLDAO.deleteOldInitializingAnnotations
    }

    super.onStart(app)
  }

  override def onStop(app: Application): Unit = {
    logger.info("Executing Global END")

    logger.info("Closing SQL Database handle")
    SQLClient.db.close()

    super.onStop(app)
  }

  def startActors(conf: Config, app: Application) {

    Akka.system(app).actorOf(
      Props(new Mailer(conf)),
      name = "mailActor")
  }

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {Ok(views.html.main())})
    }
  }

  override def onError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onError(request, ex)
  }

  def ensurePostgresDatabase = {
    logger.info("Running ensure_db.sh with POSTGRES_URL " + sys.env.get("POSTGRES_URL"))

    val processLogger = ProcessLogger(
      (o: String) => logger.info(o),
      (e: String) => logger.error(e))

    // this script is copied to the stage directory in AssetCompilation
    val result = "./tools/postgres/ensure_db.sh" ! processLogger

    if (result != 0)
      throw new Exception("Could not ensure Postgres database. Is postgres installed?")

    // diffing the actual DB schema against schema.sql:
    logger.info("Running diff_schema.sh tools/postgres/schema.sql DB")
    val errorMessage = new StringBuilder("Database schema does not fit to schema.sql:\n")
    def appendMessage(value: String) = errorMessage.append(value + "\n")
    val schemaDiffResult = "tools/postgres/diff_schema.sh tools/postgres/schema.sql DB" ! ProcessLogger(appendMessage, appendMessage)
    if (schemaDiffResult == 0) {
      logger.info("Schema is up to date.")
    } else {
      logger.error(errorMessage.toString())
      NewRelic.noticeError(errorMessage.toString())
    }

    Future.successful(())
  }

}
