package utils

import com.scalableminds.util.tools.ConfigReader
import play.api.Configuration

import javax.inject.Inject
import scala.concurrent.duration._

class WkConf @Inject()(configuration: Configuration) extends ConfigReader {
  override def raw: Configuration = configuration

  object Http {
    val uri: String = get[String]("http.uri")
  }

  object WebKnossos {
    val tabTitle: String = get[String]("webKnossos.tabTitle")
    object User {
      val timeTrackingPause: FiniteDuration = get[FiniteDuration]("webKnossos.user.timeTrackingPause")
      val inviteExpiry: Duration = get[Duration]("webKnossos.user.inviteExpiry")
      val ssoKey: String = get[String]("webKnossos.user.ssoKey")
    }
    val newOrganizationMailingList: String = get[String]("webKnossos.newOrganizationMailingList")
    object Tasks {
      val maxOpenPerUser: Int = get[Int]("webKnossos.tasks.maxOpenPerUser")
    }
    object Cache {
      object User {
        val timeout: FiniteDuration = get[FiniteDuration]("webKnossos.cache.user.timeout")
      }
      val children = List(User)
    }
    object SampleOrganization {
      val enabled: Boolean = get[Boolean]("webKnossos.initialData.sampleOrganization.enabled")
      object User {
        val email: String = get[String]("webKnossos.initialData.sampleOrganization.user.email")
        val password: String = get[String]("webKnossos.initialData.sampleOrganization.user.password")
        val isSuperUser: Boolean = get[Boolean]("webKnossos.initialData.sampleOrganization.user.isSuperUser")
      }
      val children = List(User)
    }
    val operatorData: String = get[String]("webKnossos.operatorData")
    val children = List(User, Tasks, Cache, SampleOrganization)
  }

  object Features {
    val isDemoInstance: Boolean = get[Boolean]("features.isDemoInstance")
    val jobsEnabled: Boolean = get[Boolean]("features.jobsEnabled")
    val taskReopenAllowed: FiniteDuration = get[Int]("features.taskReopenAllowedInSeconds") seconds
    val allowDeleteDatasets: Boolean = get[Boolean]("features.allowDeleteDatasets")
    val publicDemoDatasetUrl: String = get[String]("features.publicDemoDatasetUrl")
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

  object Proxy {
    val prefix: String = get[String]("proxy.prefix")
    val routes: List[String] = getList[String]("proxy.routes")
  }

  object Mail {
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

  object Jobs {
    object Flower {
      val uri: String = get[String]("jobs.flower.uri")
      val user: String = get[String]("jobs.flower.user")
      val password: String = get[String]("jobs.flower.password")
    }
    val children = List(Flower)
  }

  object Braintracing {
    val enabled: Boolean = get[Boolean]("braintracing.enabled")
    val organizationName: String = get[String]("braintracing.organizationName")
    val uri: String = get[String]("braintracing.uri")
    val createUserScript: String = get[String]("braintracing.createUserScript")
    val user: String = get[String]("braintracing.user")
    val password: String = get[String]("braintracing.password")
    val license: String = get[String]("braintracing.license")
  }

  object Airbrake {
    val projectID: String = get[String]("airbrake.projectID")
    val projectKey: String = get[String]("airbrake.projectKey")
    val environment: String = get[String]("airbrake.environment")
  }

  object GoogleAnalytics {
    val trackingID: String = get[String]("googleAnalytics.trackingID")
  }

  object SlackNotifications {
    val url: String = get[String]("slackNotifications.url")
  }

  object BackendAnalytics {
    val uri: String = get[String]("backendAnalytics.uri")
    val key: String = get[String]("backendAnalytics.key")
    val verboseLoggingEnabled: Boolean = get[Boolean]("backendAnalytics.verboseLoggingEnabled")
  }

  val children =
    List(
      Http,
      WebKnossos,
      Features,
      Tracingstore,
      Datastore,
      Proxy,
      Mail,
      Silhouette,
      Jobs,
      Braintracing,
      Airbrake,
      GoogleAnalytics,
      BackendAnalytics
    )
}
