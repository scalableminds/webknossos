import akka.actor.Props
import com.newrelic.api.agent.NewRelic
import com.scalableminds.util.mail.Mailer
import com.scalableminds.util.reactivemongo.{GlobalAccessContext, GlobalDBAccess}
import com.scalableminds.util.security.SCrypt
import com.typesafe.config.Config
import com.typesafe.scalalogging.LazyLogging
import models.binary._
import models.task._
import models.team._
import models.user._
import net.liftweb.common.Full
import oxalis.cleanup.CleanUpService
import oxalis.jobs.AvailableTasksJob
import oxalis.security.WebknossosSilhouette
import play.api._
import play.api.libs.concurrent.Execution.Implicits._
import play.api.libs.concurrent._
import play.api.libs.json.Json
import play.api.mvc.Results.Ok
import play.api.mvc._
import reactivemongo.bson.BSONObjectID

object Global extends GlobalSettings with LazyLogging {

  override def onStart(app: Application) {
    val conf = app.configuration

    logger.info("Executing Global START")
    startActors(conf.underlying, app)

    if (conf.getBoolean("application.insertInitialData") getOrElse false) {
      InitialData.insert(conf)
    }

    val tokenAuthenticatorService = WebknossosSilhouette.environment.combinedAuthenticatorService.tokenAuthenticatorService

    CleanUpService.register("deletion of expired dataTokens", tokenAuthenticatorService.dataStoreExpiry) {
      tokenAuthenticatorService.removeExpiredTokens()(GlobalAccessContext).map(r => s"deleted ${r.n}")
    }

    super.onStart(app)
  }

  def startActors(conf: Config, app: Application) {

    Akka.system(app).actorOf(
      Props(new Mailer(conf)),
      name = "mailActor")

    if (conf.getBoolean("workload.active")) {
      Akka.system(app).actorOf(
        Props(new AvailableTasksJob()),
        name = "availableTasksMailActor"
      )
    }
  }

  override def onRouteRequest(request: RequestHeader): Option[Handler] = {
    if (request.uri.matches("^(/api/|/data/|/assets/).*$")) {
      super.onRouteRequest(request)
    } else {
      Some(Action {
        Ok(views.html.main())
      })
    }
  }

  override def onError(request: RequestHeader, ex: Throwable) = {
    NewRelic.noticeError(ex)
    super.onError(request, ex)
  }
}

/**
  * Initial set of data to be imported
  * in the sample application.
  */
object InitialData extends GlobalDBAccess with LazyLogging {

  val orgTeamId = BSONObjectID.generate
  val stdOrg = Organization("Connectomics department", Nil, orgTeamId)
  val orgTeam = Team(stdOrg.name, stdOrg.name, orgTeamId)
  val mpi = Team("Connectomics department Team", stdOrg.name)


  def insert(conf: Configuration) = {
    insertDefaultUser(conf)
    insertOrganizations()
    insertTeams()
    insertTasks()
    if (conf.getBoolean("datastore.enabled").getOrElse(true)) {
      insertLocalDataStore(conf)
    }
  }

  def insertDefaultUser(conf: Configuration) = {
    UserService.defaultUser.futureBox.map {
      case Full(_) =>
      case _ =>
        val email = conf.getString("application.authentication.defaultUser.email").getOrElse("scmboy@scalableminds.com")
        val password = conf.getString("application.authentication.defaultUser.password").getOrElse("secret")
        logger.info("Inserted default user scmboy")
        UserDAO.insert(User(
          email,
          "SCM",
          "Boy",
          true,
          SCrypt.md5(password),
          stdOrg.name,
          List(TeamMembership(mpi._id, mpi.name, true), TeamMembership(stdOrg._organizationTeam, stdOrg.name, true)),
          isAdmin = true,
          loginInfo = UserService.createLoginInfo(email),
          passwordInfo = UserService.createPasswordInfo(password))
        )
    }
  }

  def insertOrganizations() = {
    OrganizationDAO.findOne().futureBox.map {
      case Full(_) =>
      case _ =>
        OrganizationDAO.insert(stdOrg)
    }
  }

  def insertTeams() = {
    TeamDAO.findOne().futureBox.map {
      case Full(_) =>
      case _ =>
        TeamDAO.insert(orgTeam)
        OrganizationDAO.addTeam(stdOrg._id, orgTeam)
        TeamDAO.insert(mpi)
        OrganizationDAO.addTeam(stdOrg._id, mpi)
    }
  }

  def insertTasks() = {
    TaskTypeDAO.findAll.map {
      types =>
        if (types.isEmpty) {
          val taskType = TaskType(
            "ek_0563_BipolarCells",
            "Check those cells out!",
            mpi._id)
          TaskTypeDAO.insert(taskType)
        }
    }
  }

  def insertLocalDataStore(conf: Configuration) = {
    DataStoreDAO.findOne(Json.obj("name" -> "localhost")).futureBox.map { maybeStore =>
      if (maybeStore.isEmpty) {
        val url = conf.getString("http.uri").getOrElse("http://localhost:9000")
        val key = conf.getString("datastore.key").getOrElse("something-secure")
        DataStoreDAO.insert(DataStore("localhost", url, WebKnossosStore, key))
      }
    }
  }
}
