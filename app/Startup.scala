import org.apache.pekko.actor.{ActorSystem, Props}
import cleanup.CleanUpService
import com.scalableminds.util.time.Instant
import com.typesafe.scalalogging.LazyLogging
import controllers.InitialDataService
import files.WkTempFileService
import mail.{Mailer, MailerConfig}
import models.annotation.AnnotationDAO
import models.dataset.ThumbnailCachingService
import models.user.InviteService
import net.liftweb.common.{Failure, Full}
import org.apache.http.client.utils.URIBuilder
import play.api.inject.ApplicationLifecycle
import security.WkSilhouetteEnvironment
import telemetry.SlackNotificationService
import utils.WkConf
import utils.sql.SqlClient

import javax.inject._
import scala.collection.mutable
import scala.concurrent.{ExecutionContext, Future}
import scala.concurrent.duration._
import scala.sys.process._

class Startup @Inject()(actorSystem: ActorSystem,
                        conf: WkConf,
                        initialDataService: InitialDataService,
                        cleanUpService: CleanUpService,
                        annotationDAO: AnnotationDAO,
                        wkSilhouetteEnvironment: WkSilhouetteEnvironment,
                        lifecycle: ApplicationLifecycle,
                        tempFileService: WkTempFileService,
                        inviteService: InviteService,
                        thumbnailCachingService: ThumbnailCachingService,
                        sqlClient: SqlClient,
                        slackNotificationService: SlackNotificationService)(implicit ec: ExecutionContext)
    extends LazyLogging {

  private val beforeStartup = Instant.now

  logger.info(s"Executing Startup: Start actors, register cleanup services and stop hooks...")

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

  cleanUpService.register("deletion of expired thumbnails", 1 day) {
    thumbnailCachingService.removeExpiredThumbnails()
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Closing SQL Database handle")
      sqlClient.db.close()
    }
  }

  lifecycle.addStopHook { () =>
    Future.successful {
      logger.info("Deleting temporary files")
      tempFileService.cleanUpAll()
    }
  }

  private lazy val postgresUrl = {
    val slickUrl =
      if (conf.Slick.Db.url.startsWith("jdbc:"))
        conf.Slick.Db.url.substring(5)
      else conf.Slick.Db.url
    val uri = new URIBuilder(slickUrl)
    uri.setUserInfo(conf.Slick.Db.user, conf.Slick.Db.password)
    uri.build().toString
  }

  if (conf.Slick.checkSchemaOnStartup) {
    ensurePostgresDatabase()
    ensurePostgresSchema()
  }

  initialDataService.insert.futureBox.map {
    case Full(_) => Instant.logSince(beforeStartup, "Webknossos startup", logger)
    case Failure(msg, _, _) =>
      logger.info("No initial data inserted: " + msg)
      Instant.logSince(beforeStartup, "Webknossos startup", logger)
    case _ => ()
  }

  private def ensurePostgresSchema(): Unit = {
    logger.info("Checking database schema…")

    val errorMessageBuilder = mutable.ListBuffer[String]()
    val capturingProcessLogger =
      ProcessLogger((o: String) => errorMessageBuilder.append(o), (e: String) => errorMessageBuilder.append(e))

    val result = Process("./tools/postgres/dbtool.js check-db-schema", None, "POSTGRES_URL" -> postgresUrl) ! capturingProcessLogger
    if (result == 0) {
      logger.info("Database schema is up to date.")
    } else {
      val errorMessage = errorMessageBuilder.toList.mkString("\n")
      logger.error("dbtool: " + errorMessage)
      slackNotificationService.warn("SQL schema mismatch", errorMessage)
    }
  }

  private def ensurePostgresDatabase(): Unit = {
    logger.info(s"Ensuring Postgres database…")
    val processLogger =
      ProcessLogger((o: String) => logger.info(s"dbtool: $o"), (e: String) => logger.error(s"dbtool: $e"))

    // this script is copied to the stage directory in AssetCompilation
    val result = Process("./tools/postgres/dbtool.js ensure-db", None, "POSTGRES_URL" -> postgresUrl) ! processLogger
    if (result != 0)
      throw new Exception("Could not ensure Postgres database. Is postgres installed?")
  }

  private def startActors(actorSystem: ActorSystem) = {
    val mailerConf = MailerConfig(
      conf.Mail.logToStdout,
      conf.Mail.Smtp.host,
      conf.Mail.Smtp.port,
      conf.Mail.Smtp.tls,
      conf.Mail.Smtp.auth,
      conf.Mail.Smtp.user,
      conf.Mail.Smtp.pass,
    )
    actorSystem.actorOf(Props(new Mailer(mailerConf)), name = "mailActor")
  }

}
