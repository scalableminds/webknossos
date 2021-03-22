import java.io.{ByteArrayOutputStream, File}

import akka.actor.{ActorSystem, Props}
import com.scalableminds.util.mail.{Mailer, MailerConfig}
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import io.apigee.trireme.core.{NodeEnvironment, Sandbox}
import javax.inject._
import models.annotation.AnnotationDAO
import models.user.InviteService
import net.liftweb.common.{Failure, Full}
import oxalis.cleanup.CleanUpService
import oxalis.security.WkSilhouetteEnvironment
import oxalis.telemetry.SlackNotificationService
import play.api.inject.ApplicationLifecycle
import utils.{SQLClient, WkConf}

import scala.concurrent.ExecutionContext.Implicits.global
import scala.concurrent.Future
import scala.concurrent.duration._
import scala.sys.process._

class Startup @Inject()(actorSystem: ActorSystem,
                        conf: WkConf,
                        initialDataService: InitialDataService,
                        cleanUpService: CleanUpService,
                        annotationDAO: AnnotationDAO,
                        wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                        lifecycle: ApplicationLifecycle,
                        inviteService: InviteService,
                        sqlClient: SQLClient,
                        slackNotificationService: SlackNotificationService)
    extends LazyLogging {

  logger.info("Executing Startup")
  startActors(actorSystem)

  private val tokenAuthenticatorService = wkSilhouetteEnvironment.combinedAuthenticatorService.tokenAuthenticatorService

  cleanUpService.register("deletion of expired tokens", tokenAuthenticatorService.dataStoreExpiry) {
    tokenAuthenticatorService.removeExpiredTokens()
  }

  cleanUpService.register("deletion of expired invites", 1 day) {
    inviteService.removeExpiredInvites()
  }

  cleanUpService.register("deletion of old annotations in initializing state", 1 day) {
    annotationDAO.deleteOldInitializingAnnotations()
  }

  ensurePostgresDatabase.onComplete { _ =>
    initialDataService.insert.futureBox.map {
      case Full(_)            => ()
      case Failure(msg, _, _) => logger.info("No initial data inserted: " + msg)
      case _                  => logger.warn("Error while inserting initial data")
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

    val processLogger = ProcessLogger((o: String) => logger.info(o), (e: String) => logger.error(e))

    // this script is copied to the stage directory in AssetCompilation
    val result = "./tools/postgres/ensure_db.sh" ! processLogger

    if (result != 0)
      throw new Exception("Could not ensure Postgres database. Is postgres installed?")

    // diffing the actual DB schema against schema.sql:
    logger.info("Running diff_schema.js tools/postgres/schema.sql DB")
    val nodeEnv = new NodeEnvironment()
    nodeEnv.setDefaultNodeVersion("0.12")
    val nodeOutput = new ByteArrayOutputStream()
    nodeEnv.setSandbox(new Sandbox().setStdout(nodeOutput).setStderr(nodeOutput))
    val script = nodeEnv.createScript(
      "diff_schema.js",
      new File("tools/postgres/diff_schema.js"),
      Array("tools/postgres/schema.sql", "DB")
    )
    val status = script.execute().get()
    if (status.getExitCode == 0) {
      logger.info("Schema is up to date.")
    } else {
      val nodeOut = new String(nodeOutput.toByteArray, "UTF-8")
      val errorMessage = s"Database schema does not fit to schema.sql! \n ${nodeOut}"
      logger.error(errorMessage)
      slackNotificationService.warn("SQL schema mismatch", errorMessage)
    }

    Future.successful(())
  }

  private def startActors(actorSystem: ActorSystem) {
    val mailerConf = MailerConfig(
      conf.Mail.enabled,
      conf.Mail.logToStdout,
      conf.Mail.Smtp.host,
      conf.Mail.Smtp.port,
      conf.Mail.Smtp.tls,
      conf.Mail.Smtp.user,
      conf.Mail.Smtp.pass,
    )
    actorSystem.actorOf(Props(new Mailer(mailerConf)), name = "mailActor")
  }

}
