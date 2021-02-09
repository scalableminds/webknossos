package utils

import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import javax.inject.Inject
import scala.concurrent.duration._

class WkConf @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw = configuration

  object Application {

    val insertInitialData = get[Boolean]("application.insertInitialData")
    val insertLocalConnectDatastore = get[Boolean]("application.insertLocalConnectDatastore")
    val title = get[String]("application.title")

    object Authentication {
      object DefaultUser {
        val email = get[String]("application.authentication.defaultUser.email")
        val password = get[String]("application.authentication.defaultUser.password")
        val isSuperUser = get[Boolean]("application.authentication.defaultUser.isSuperUser")
      }
      val ssoKey = get[String]("application.authentication.ssoKey")
      val inviteExpiry = get[Duration]("application.authentication.inviteExpiry")
      val children = List(DefaultUser)
    }
    val children = List(Authentication)
  }

  object Http {
    val uri = get[String]("http.uri")
    val port = get[Int]("http.port")
  }

  object Mail {
    val enabled = get[Boolean]("mail.enabled")
    val logToStdout = get[Boolean]("mail.logToStdout")
    object Smtp {
      val host = get[String]("mail.smtp.host")
      val port = get[Int]("mail.smtp.port")
      val tls = get[Boolean]("mail.smtp.tls")
      val auth = get[Boolean]("mail.smtp.auth")
      val user = get[String]("mail.smtp.user")
      val pass = get[String]("mail.smtp.pass")
    }
    val demoSender = get[String]("mail.demoSender")
    val defaultSender = get[String]("mail.defaultSender")
  }

  object WebKnossos {
    object User {
      object Time {
        val tracingPauseInSeconds = get[Int]("webKnossos.user.time.tracingPauseInSeconds") seconds
      }
      val children = List(Time)
    }
    object Tasks {
      val maxOpenPerUser = get[Int]("webKnossos.tasks.maxOpenPerUser")
    }
    val newOrganizationMailingList = get[String]("webKnossos.newOrganizationMailingList")

    val children = List(User, Tasks)
  }

  object Proxy {
    val prefix = get[String]("proxy.prefix")
    val routes = getList[String]("proxy.routes")
  }

  object Datastore {
    val enabled = get[Boolean]("datastore.enabled")
    val key = get[String]("datastore.key")
    val publicUri = getOptional[String]("datastore.publicUri")
  }

  object Tracingstore {
    val enabled = get[Boolean]("tracingstore.enabled")
    val key = get[String]("tracingstore.key")
    val publicUri = getOptional[String]("tracingstore.publicUri")
  }

  object User {
    val cacheTimeoutInMinutes = get[Int]("user.cacheTimeoutInMinutes") minutes
  }

  object Braintracing {
    val active = get[Boolean]("braintracing.active")
    val organizationName = get[String]("braintracing.organizationName")
    val url = get[String]("braintracing.url")
    val createUserScript = get[String]("braintracing.createUserScript")
    val user = get[String]("braintracing.user")
    val password = get[String]("braintracing.password")
    val license = get[String]("braintracing.license")
  }

  object Features {
    val isDemoInstance = get[Boolean]("features.isDemoInstance")
    val jobsEnabled = get[Boolean]("features.jobsEnabled")
    val taskReopenAllowed = get[Int]("features.taskReopenAllowedInSeconds") seconds
    val allowDeleteDatasets = get[Boolean]("features.allowDeleteDatasets")
  }

  val operatorData = get[String]("operatorData")

  object Silhouette {
    object TokenAuthenticator {
      val resetPasswordExpiry = get[Duration]("silhouette.tokenAuthenticator.resetPasswordExpiry")
      val dataStoreExpiry = get[Duration]("silhouette.tokenAuthenticator.dataStoreExpiry")
      val authenticatorExpiry = get[Duration]("silhouette.tokenAuthenticator.authenticatorExpiry")
      val authenticatorIdleTimeout = get[Duration]("silhouette.tokenAuthenticator.authenticatorIdleTimeout")
    }
    object CookieAuthenticator {
      val cookieName = get[String]("silhouette.cookieAuthenticator.cookieName")
      val cookiePath = get[String]("silhouette.cookieAuthenticator.cookiePath")
      val secureCookie = get[Boolean]("silhouette.cookieAuthenticator.secureCookie")
      val httpOnlyCookie = get[Boolean]("silhouette.cookieAuthenticator.httpOnlyCookie")
      val useFingerprinting = get[Boolean]("silhouette.cookieAuthenticator.useFingerprinting")
      val authenticatorExpiry = get[Duration]("silhouette.cookieAuthenticator.authenticatorExpiry")
      val cookieMaxAge = get[Duration]("silhouette.cookieAuthenticator.cookieMaxAge")
    }
    val children = List(TokenAuthenticator, CookieAuthenticator)
  }

  object Airbrake {
    val projectID = get[String]("airbrake.projectID")
    val projectKey = get[String]("airbrake.projectKey")
    val environment = get[String]("airbrake.environment")
  }

  object SlackNotifications {
    val url = get[String]("slackNotifications.url")
  }

  object Google {
    object Analytics {
      val trackingID = get[String]("google.analytics.trackingID")
    }
    val children = List(Analytics)
  }

  object Jobs {
    object Flower {
      val uri = get[String]("jobs.flower.uri")
      val username = get[String]("jobs.flower.username")
      val password = get[String]("jobs.flower.password")
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
         Jobs)
}
