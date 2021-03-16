package utils

import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import javax.inject.Inject
import scala.concurrent.duration._

class WkConf @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw: Configuration = configuration

  object Application {

    val insertInitialData: Boolean = get[Boolean]("application.insertInitialData")
    val insertLocalConnectDatastore: Boolean = get[Boolean]("application.insertLocalConnectDatastore")
    val title: String = get[String]("application.title")

    object Authentication {
      object DefaultUser {
        val email: String = get[String]("application.authentication.defaultUser.email")
        val password: String = get[String]("application.authentication.defaultUser.password")
        val isSuperUser: Boolean = get[Boolean]("application.authentication.defaultUser.isSuperUser")
      }
      val ssoKey: String = get[String]("application.authentication.ssoKey")
      val inviteExpiry: Duration = get[Duration]("application.authentication.inviteExpiry")
      val children = List(DefaultUser)
    }
    val children = List(Authentication)
  }

  object Http {
    val uri: String = get[String]("http.uri")
    val port: Int = get[Int]("http.port")
  }

  object Mail {
    val enabled: Boolean = get[Boolean]("mail.enabled")
    val logToStdout: Boolean = get[Boolean]("mail.logToStdout")
    object Smtp {
      val host: String = get[String]("mail.smtp.host")
      val port: Int = get[Int]("mail.smtp.port")
      val tls: Boolean = get[Boolean]("mail.smtp.tls")
      val auth: Boolean = get[Boolean]("mail.smtp.auth")
      val user: String = get[String]("mail.smtp.user")
      val pass: String = get[String]("mail.smtp.pass")
    }
    val demoSender: String = get[String]("mail.demoSender")
    val defaultSender: String = get[String]("mail.defaultSender")
  }

  object WebKnossos {
    object User {
      object Time {
        val tracingPauseInSeconds: FiniteDuration = get[Int]("webKnossos.user.time.tracingPauseInSeconds") seconds
      }
      val children = List(Time)
    }
    object Tasks {
      val maxOpenPerUser: Int = get[Int]("webKnossos.tasks.maxOpenPerUser")
    }
    val newOrganizationMailingList: String = get[String]("webKnossos.newOrganizationMailingList")

    val children = List(User, Tasks)
  }

  object Proxy {
    val prefix: String = get[String]("proxy.prefix")
    val routes: List[String] = getList[String]("proxy.routes")
  }

  object Datastore {
    val enabled: Boolean = get[Boolean]("datastore.enabled")
    val key: String = get[String]("datastore.key")
    val publicUri: Option[String] = getOptional[String]("datastore.publicUri")
  }

  object Tracingstore {
    val enabled: Boolean = get[Boolean]("tracingstore.enabled")
    val key: String = get[String]("tracingstore.key")
    val publicUri: Option[String] = getOptional[String]("tracingstore.publicUri")
  }

  object User {
    val cacheTimeoutInMinutes: FiniteDuration = get[Int]("user.cacheTimeoutInMinutes") minutes
  }

  object Braintracing {
    val active: Boolean = get[Boolean]("braintracing.active")
    val organizationName: String = get[String]("braintracing.organizationName")
    val url: String = get[String]("braintracing.url")
    val createUserScript: String = get[String]("braintracing.createUserScript")
    val user: String = get[String]("braintracing.user")
    val password: String = get[String]("braintracing.password")
    val license: String = get[String]("braintracing.license")
  }

  object Features {
    val isDemoInstance: Boolean = get[Boolean]("features.isDemoInstance")
    val jobsEnabled: Boolean = get[Boolean]("features.jobsEnabled")
    val taskReopenAllowed: FiniteDuration = get[Int]("features.taskReopenAllowedInSeconds") seconds
    val allowDeleteDatasets: Boolean = get[Boolean]("features.allowDeleteDatasets")
    val publicDemoDatasetUrl: String = get[String]("features.publicDemoDatasetUrl")
    val exportTiffMaxVolumeMVx: Long = get[Long]("features.exportTiffMaxVolumeMVx")
    val exportTiffMaxEdgeLengthVx: Long = get[Long]("features.exportTiffMaxEdgeLengthVx")
  }

  object BackendAnalytics {
    val uri: String = get[String]("backendAnalytics.uri")
    val key: String = get[String]("backendAnalytics.key")
    val verboseLoggingEnabled: Boolean = get[Boolean]("backendAnalytics.verboseLoggingEnabled")
  }

  val operatorData: String = get[String]("operatorData")

  object Silhouette {
    object TokenAuthenticator {
      val resetPasswordExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.resetPasswordExpiry")
      val dataStoreExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.dataStoreExpiry")
      val authenticatorExpiry: Duration = get[Duration]("silhouette.tokenAuthenticator.authenticatorExpiry")
      val authenticatorIdleTimeout: Duration = get[Duration]("silhouette.tokenAuthenticator.authenticatorIdleTimeout")
    }
    object CookieAuthenticator {
      val cookieName: String = get[String]("silhouette.cookieAuthenticator.cookieName")
      val cookiePath: String = get[String]("silhouette.cookieAuthenticator.cookiePath")
      val secureCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.secureCookie")
      val httpOnlyCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.httpOnlyCookie")
      val useFingerprinting: Boolean = get[Boolean]("silhouette.cookieAuthenticator.useFingerprinting")
      val authenticatorExpiry: Duration = get[Duration]("silhouette.cookieAuthenticator.authenticatorExpiry")
      val cookieMaxAge: Duration = get[Duration]("silhouette.cookieAuthenticator.cookieMaxAge")
    }
    val children = List(TokenAuthenticator, CookieAuthenticator)
  }

  object Airbrake {
    val projectID: String = get[String]("airbrake.projectID")
    val projectKey: String = get[String]("airbrake.projectKey")
    val environment: String = get[String]("airbrake.environment")
  }

  object SlackNotifications {
    val url: String = get[String]("slackNotifications.url")
    val verboseLoggingEnabled: Boolean = get[Boolean]("slackNotifications.verboseLoggingEnabled")
  }

  object Google {
    object Analytics {
      val trackingID: String = get[String]("google.analytics.trackingID")
    }
    val children = List(Analytics)
  }

  object Jobs {
    object Flower {
      val uri: String = get[String]("jobs.flower.uri")
      val username: String = get[String]("jobs.flower.username")
      val password: String = get[String]("jobs.flower.password")
    }
    val children = List(Flower)
  }

  val children =
    List(Application,
         Http,
         Mail,
         WebKnossos,
         Datastore,
         Tracingstore,
         User,
         Braintracing,
         Features,
         Silhouette,
         Airbrake,
         Google,
         BackendAnalytics,
         Jobs)
}
