package bootstrap.liftweb

import _root_.net.liftweb.common._
import _root_.net.liftweb.http._
import _root_.net.liftweb.http.provider._
import _root_.net.liftweb.sitemap._
import _root_.net.liftweb.sitemap.Loc._
import com.scalableminds.brainflight.handler.RequestHandler
import com.scalableminds.brainflight.binary.{FrustrumModel, ModelStore, CubeModel}
import org.bson.types.ObjectId
import com.scalableminds.brainflight.lib.{MongoConfig, ScalaSilentLogger}
import com.scalableminds.brainflight.model.{SessionRoute, FlightRoute, User}
import net.liftweb.util.Props
import java.util.Properties
import java.util.logging.LogManager
import java.io.{PipedInputStream, PipedOutputStream}
import net.liftmodules.mongoauth.{Locs, MongoAuth}
import com.scalableminds.brainflight.config.Sitemap
import com.scalableminds.config.SmtpMailer


/**
 * A class that's instantiated early and run.  It allows the application
 * to modify lift's environment
 */
class Boot {
  /**
   * Changes Javas interal logging level, prevents an exception to be printed
   * when the availigility check of the mongodb fails
   */
  def boot {

    // config an email sender
    SmtpMailer.init

    MongoConfig.init
    if (!MongoConfig.running_?) {
      Props.get("mongo.autostart", "false") match {
        case "false" =>
          println("No Mongo could be found!exiting....")
          sys.exit()
        case "true" =>
          import scala.sys.process._
          println("[STARTING MONGO]")
          val mongoParams = Props.get("mongo.autostart.params") match {
            case Full(p) => " " + p
            case _ => ""
          }
          ("mongod" + mongoParams).run(new ScalaSilentLogger)
          Thread.sleep(500) // give mongod some time to start up
          println("[MONGO SHOULD BE RUNNING]")
          MongoConfig.init
      }
    }
    // init mongoauth
    MongoAuth.authUserMeta.default.set(User)

    // add our custom dispatcher
    LiftRules.dispatch.append {
      RequestHandler
    }
    // where to search snippet
    LiftRules.addToPackages("com.scalableminds.brainflight")

    LiftRules.resourceNames = "stringTranslations" :: Nil

    //LiftRules.setSiteMapFunc(() => SiteMap(menueEntries: _*))
    LiftRules.setSiteMapFunc(() => Sitemap.siteMap)

    // when the session is about to get closed, the route needs to be saved or it will get lost
    LiftSession.onAboutToShutdownSession ::= (_ => {
      SessionRoute.saveRoute(User.currentUser)
    })

    // exclude lift ajax files for flight simulator
    LiftRules.autoIncludeAjax = (session =>
      S.request match {
        case Full(Req("static" :: _, _, _)) =>
          false
        case _ =>
          true
      })
    /*
     * Show the spinny image when an Ajax call starts
     */
    LiftRules.ajaxStart =
      Full(() => LiftRules.jsArtifacts.show("ajax-loader").cmd)

    /*
     * Make the spinny image go away when it ends
     */
    LiftRules.ajaxEnd =
      Full(() => LiftRules.jsArtifacts.hide("ajax-loader").cmd)
    LiftRules.early.append(makeUtf8)

    LiftRules.loggedInTest = Full(() => User.isLoggedIn)
    // checks for ExtSession cookie
    LiftRules.earlyInStateful.append(User.testForExtSession)

    /*
     * Register all BinaryDataModels
     */
    ModelStore.register(CubeModel, FrustrumModel)
    LiftRules.htmlProperties.default.set((r: Req) => new Html5Properties(r.userAgent))
  }


  /**
   * Force the request to be UTF-8
   */
  private def makeUtf8(req: HTTPRequest) {
    req.setCharacterEncoding("UTF-8")
  }
}
