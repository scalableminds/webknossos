import akka.actor.{ActorSystem, Props}
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.accesscontext.GlobalAccessContext
import com.scalableminds.util.mail.{Mailer, MailerConfig}
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import javax.inject._
import models.annotation.AnnotationDAO
import net.liftweb.common.{Failure, Full}
import oxalis.cleanup.CleanUpService
import oxalis.security.{WkSilhouetteEnvironment, WkEnv}
import com.mohiva.play.silhouette.api.Silhouette
import play.api.inject.ApplicationLifecycle
import utils.{SQLClient, WkConf}

import scala.concurrent.duration._
import scala.concurrent.Future
import scala.concurrent.ExecutionContext.Implicits.global
import scala.sys.process._


class Startup @Inject() (actorSystem: ActorSystem,
                         conf: WkConf,
                         initialDataService: InitialDataService,
                         cleanUpService: CleanUpService,
                         annotationDAO: AnnotationDAO,
                         wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                         lifecycle: ApplicationLifecycle,
                         sqlClient: SQLClient
                        ) extends LazyLogging {

  logger.info("Executing Startup")
  startActors(actorSystem)

  val tokenAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  cleanUpService.register("deletion of expired tokens", tokenAuthenticatorService.dataStoreExpiry) {
    tokenAuthenticatorService.removeExpiredTokens(GlobalAccessContext)
  }

  cleanUpService.register("deletion of old annotations in initializing state", 1 day) {
    annotationDAO.deleteOldInitializingAnnotations
  }

  ensurePostgresDatabase.onComplete { _ =>
    if (conf.Application.insertInitialData) {
      initialDataService.insert.futureBox.map {
        case Full(_) => ()
        case Failure(msg, _, _) => logger.info("No initial data inserted: " + msg)
        case _ => logger.warn("Error while inserting initial data")
      }
    }
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing SQL Database handle")
      sqlClient.db.close()
    }
  }

  private def ensurePostgresDatabase = {
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
    val schemaDiffResult = "tools/postgres/diff_schema.js tools/postgres/schema.sql DB" ! ProcessLogger(appendMessage, appendMessage)
    if (schemaDiffResult == 0) {
      logger.info("Schema is up to date.")
    } else {
      logger.error(errorMessage.toString())
      NewRelic.noticeError(errorMessage.toString())
    }

    Future.successful(())
  }

  private def startActors(actorSystem: ActorSystem) {
    val mailerConf = MailerConfig(
      conf.Mail.enabled,
      conf.Mail.Smtp.host,
      conf.Mail.Smtp.port,
      conf.Mail.Smtp.tls,
      conf.Mail.Smtp.user,
      conf.Mail.Smtp.pass,
      conf.Mail.Subject.prefix
    )
    actorSystem.actorOf(
      Props(new Mailer(mailerConf)),
      name = "mailActor")
  }

}
