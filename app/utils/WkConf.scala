package utils

import com.scalableminds.util.time.Instant
import com.scalableminds.util.tools.ConfigReader
import com.typesafe.scalalogging.LazyLogging
import play.api.Configuration
import security.CertificateValidationService

import javax.inject.Inject
import scala.concurrent.duration._

class WkConf @Inject()(configuration: Configuration, certificateValidationService: CertificateValidationService)
    extends ConfigReader
    with LazyLogging {
  override def raw: Configuration = configuration
  lazy val featureOverrides: Map[String, Boolean] = certificateValidationService.getFeatureOverrides

  object Http {
    val uri: String = get[String]("http.uri")
    val port: String = get[String]("http.port")
  }

  object Play {
    object Modules {
      val enabled: Seq[String] = getList[String]("play.modules.enabled")
      val disabled: Seq[String] = getList[String]("play.modules.disabled")
    }

    val children = List(Modules)
  }

  object WebKnossos {
    val tabTitle: String = get[String]("webKnossos.tabTitle")

    object User {
      val timeTrackingPause: FiniteDuration = get[FiniteDuration]("webKnossos.user.timeTrackingPause")
      val timeTrackingOnlyWithSignificantChanges: Boolean =
        get[Boolean]("webKnossos.user.timeTrackingOnlyWithSignificantChanges")
      val inviteExpiry: FiniteDuration = get[FiniteDuration]("webKnossos.user.inviteExpiry")
      val ssoKey: String = get[String]("webKnossos.user.ssoKey")

      object EmailVerification {
        val activated: Boolean = get[Boolean]("webKnossos.user.emailVerification.activated")
        val required: Boolean = get[Boolean]("webKnossos.user.emailVerification.required")
        val gracePeriod: FiniteDuration = get[FiniteDuration]("webKnossos.user.emailVerification.gracePeriod")
        val linkExpiry: Option[FiniteDuration] =
          getOptional[FiniteDuration]("webKnossos.user.emailVerification.linkExpiry")
      }

    }

    val newOrganizationMailingList: String = get[String]("webKnossos.newOrganizationMailingList")

    object Tasks {
      val maxOpenPerUser: Int = get[Int]("webKnossos.tasks.maxOpenPerUser")
    }

    object Annotation {
      object Mutex {
        val expiryTime: FiniteDuration = get[FiniteDuration]("webKnossos.annotation.mutex.expiryTime")
      }
    }

    object Cache {
      object User {
        val timeout: FiniteDuration = get[FiniteDuration]("webKnossos.cache.user.timeout")
      }

      val children = List(User)
    }

    object SampleOrganization {
      val enabled: Boolean = get[Boolean]("webKnossos.sampleOrganization.enabled")

      object User {
        val email: String = get[String]("webKnossos.sampleOrganization.user.email")
        val email2: String = get[String]("webKnossos.sampleOrganization.user.email2")
        val password: String = get[String]("webKnossos.sampleOrganization.user.password")
        val token: String = get[String]("webKnossos.sampleOrganization.user.token")
        val isSuperUser: Boolean = get[Boolean]("webKnossos.sampleOrganization.user.isSuperUser")
      }

      val children = List(User)
    }

    object FetchUsedStorage {
      val rescanInterval: FiniteDuration = get[FiniteDuration]("webKnossos.fetchUsedStorage.rescanInterval")
      val tickerInterval: FiniteDuration = get[FiniteDuration]("webKnossos.fetchUsedStorage.tickerInterval")
      val scansPerTick: Int = get[Int]("webKnossos.fetchUsedStorage.scansPerTick")
    }

    object TermsOfService {
      val enabled: Boolean = get[Boolean]("webKnossos.termsOfService.enabled")
      val url: String = get[String]("webKnossos.termsOfService.url")
      val acceptanceDeadline: Instant = get[Instant]("webKnossos.termsOfService.acceptanceDeadline")
      val version: Int = get[Int]("webKnossos.termsOfService.version")
    }

    object SecurityTxt {
      val enabled: Boolean = get[Boolean]("webKnossos.securityTxt.enabled")
      val content: String = get[String]("webKnossos.securityTxt.content")
    }

    val operatorData: String = get[String]("webKnossos.operatorData")
    val children = List(User, Tasks, Cache, SampleOrganization, FetchUsedStorage, TermsOfService)
  }

  object SingleSignOn {
    object OpenIdConnect {
      val providerUrl: String = get[String]("singleSignOn.openIdConnect.providerUrl")
      val clientId: String = get[String]("singleSignOn.openIdConnect.clientId")
      val clientSecret: String = get[String]("singleSignOn.openIdConnect.clientSecret")
      val scope: String = get[String]("singleSignOn.openIdConnect.scope")
      val verboseLoggingEnabled: Boolean = get[Boolean]("singleSignOn.openIdConnect.verboseLoggingEnabled")
    }
  }

  object Features {
    val isWkorgInstance: Boolean = get[Boolean]("features.isWkorgInstance")
    val jobsEnabled: Boolean = get[Boolean]("features.jobsEnabled")
    val voxelyticsEnabled: Boolean = get[Boolean]("features.voxelyticsEnabled")
    val taskReopenAllowed: FiniteDuration = get[Int]("features.taskReopenAllowedInSeconds") seconds
    val allowDeleteDatasets: Boolean = get[Boolean]("features.allowDeleteDatasets")
    val publicDemoDatasetUrl: String = get[String]("features.publicDemoDatasetUrl")
    val exportTiffMaxVolumeMVx: Long = get[Long]("features.exportTiffMaxVolumeMVx")
    val exportTiffMaxEdgeLengthVx: Long = get[Long]("features.exportTiffMaxEdgeLengthVx")
    val openIdConnectEnabled: Boolean =
      featureOverrides.getOrElse("openIdConnectEnabled", get[Boolean]("features.openIdConnectEnabled"))
    val editableMappingsEnabled: Boolean =
      featureOverrides.getOrElse("editableMappingsEnabled", get[Boolean]("features.editableMappingsEnabled"))
    val segmentAnythingEnabled: Boolean =
      featureOverrides.getOrElse("segmentAnythingEnabled", get[Boolean]("features.segmentAnythingEnabled"))
  }

  object Datastore {
    val key: String = get[String]("datastore.key")
    val name: String = get[String]("datastore.name")
    val publicUri: Option[String] = getOptional[String]("datastore.publicUri")
  }

  object Tracingstore {
    val key: String = get[String]("tracingstore.key")
    val name: String = get[String]("datastore.name")
    val publicUri: Option[String] = getOptional[String]("tracingstore.publicUri")
  }

  object AboutPageRedirect {
    val prefix: String = get[String]("aboutPageRedirect.prefix")
    val routes: List[String] = getList[String]("aboutPageRedirect.routes")
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

    val defaultSender: String = get[String]("mail.defaultSender")
    def additionalFooter: String = get[String]("mail.additionalFooter")

    object Mailchimp {
      val host: String = get[String]("mail.mailchimp.host")
      val listId: String = get[String]("mail.mailchimp.listId")
      val user: String = get[String]("mail.mailchimp.user")
      val password: String = get[String]("mail.mailchimp.password")
    }

    val children = List(Smtp, Mailchimp)
  }

  object Silhouette {
    object TokenAuthenticator {
      val resetPasswordExpiry: FiniteDuration = get[FiniteDuration]("silhouette.tokenAuthenticator.resetPasswordExpiry")
      val dataStoreExpiry: FiniteDuration = get[FiniteDuration]("silhouette.tokenAuthenticator.dataStoreExpiry")
      val authenticatorExpiry: FiniteDuration = get[FiniteDuration]("silhouette.tokenAuthenticator.authenticatorExpiry")
      val authenticatorIdleTimeout: FiniteDuration =
        get[FiniteDuration]("silhouette.tokenAuthenticator.authenticatorIdleTimeout")
    }

    object CookieAuthenticator {
      val cookieName: String = get[String]("silhouette.cookieAuthenticator.cookieName")
      val cookiePath: String = get[String]("silhouette.cookieAuthenticator.cookiePath")
      val secureCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.secureCookie")
      val httpOnlyCookie: Boolean = get[Boolean]("silhouette.cookieAuthenticator.httpOnlyCookie")
      val useFingerprinting: Boolean = get[Boolean]("silhouette.cookieAuthenticator.useFingerprinting")
      val authenticatorExpiry: FiniteDuration =
        get[FiniteDuration]("silhouette.cookieAuthenticator.authenticatorExpiry")
      val cookieMaxAge: FiniteDuration = get[FiniteDuration]("silhouette.cookieAuthenticator.cookieMaxAge")
      val signerSecret: String = get[String]("silhouette.cookieAuthenticator.signerSecret")
    }

    val children = List(TokenAuthenticator, CookieAuthenticator)
  }

  object Jobs {
    val workerLivenessTimeout: FiniteDuration = get[FiniteDuration]("jobs.workerLivenessTimeout")
  }

  object Airbrake {
    val projectID: String = get[String]("airbrake.projectID")
    val projectKey: String = get[String]("airbrake.projectKey")
    val environment: String = get[String]("airbrake.environment")
  }

  object SlackNotifications {
    val uri: String = get[String]("slackNotifications.uri")
    val verboseLoggingEnabled: Boolean = get[Boolean]("slackNotifications.verboseLoggingEnabled")
  }

  object BackendAnalytics {
    val uri: String = get[String]("backendAnalytics.uri")
    val key: String = get[String]("backendAnalytics.key")
    val sessionPause: FiniteDuration = get[FiniteDuration]("backendAnalytics.sessionPause")
    val saveToDatabaseEnabled: Boolean = get[Boolean]("backendAnalytics.saveToDatabaseEnabled")
    val verboseLoggingEnabled: Boolean = get[Boolean]("backendAnalytics.verboseLoggingEnabled")
    val wellKnownUris: List[String] = getList[String]("backendAnalytics.wellKnownUris")
  }

  object Slick {
    val checkSchemaOnStartup: Boolean = get[Boolean]("slick.checkSchemaOnStartup")

    object Db {
      val url: String = get[String]("slick.db.url")
      val user: String = get[String]("slick.db.user")
      val password: String = get[String]("slick.db.password")
    }

    val children = List(Db)
  }

  object Voxelytics {
    val staleTimeout: FiniteDuration = get[FiniteDuration]("voxelytics.staleTimeout")

    object Loki {
      val uri: String = get[String]("voxelytics.loki.uri")
      val startupTimeout: FiniteDuration = get[FiniteDuration]("voxelytics.loki.startupTimeout")
    }

    val children = List(Loki)
  }

  object SegmentAnything {
    val uri: String = get[String]("segmentAnything.uri")
    val user: String = get[String]("segmentAnything.user")
    val password: String = get[String]("segmentAnything.password")
  }

  val children =
    List(
      Http,
      WebKnossos,
      Features,
      Tracingstore,
      Datastore,
      AboutPageRedirect,
      Mail,
      Silhouette,
      Jobs,
      Airbrake,
      BackendAnalytics,
      Slick,
      Voxelytics,
      SegmentAnything
    )

}
