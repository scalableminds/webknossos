package bootstrap.liftweb

import _root_.net.liftweb.common._
import _root_.net.liftweb.http._
import _root_.net.liftweb.http.provider._
import _root_.net.liftweb.sitemap._
import _root_.net.liftweb.sitemap.Loc._
import com.scalableminds.brainflight.handler.RequestHandler
import com.scalableminds.brainflight.binary.{FrustrumModel, ModelStore, CubeModel}
import com.scalableminds.brainflight.model.{MongoConfig, User}


/**
 * A class that's instantiated early and run.  It allows the application
 * to modify lift's environment
 */
class Boot {
  def boot {
    MongoConfig.init
    if(!MongoConfig.isMongoRunning){
      println("No Mongo could be found!exiting....")
      sys.exit()
    }

    // add our custom dispatcher
    LiftRules.dispatch.append{RequestHandler}
    // where to search snippet
    LiftRules.addToPackages("com.scalableminds.brainflight")

    LiftRules.resourceNames = "stringTranslations" :: Nil

    // Build SiteMap
    def entries = Menu(Loc("Home", List("index"), "Home")) ::
    Menu(Loc("Static", Link(List("static"), true, "/static/index"),
      "Static Content")) ::
    User.sitemap

    LiftRules.setSiteMapFunc(()=>SiteMap(entries:_*))

    // exclude lift ajax files for flight simulator
    LiftRules.autoIncludeAjax = (session =>
      S.request match {
        case Full(Req("static" :: _,_,_)) =>
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

    LiftRules.loggedInTest = Full(() => User.loggedIn_?)

    /*
     * Register all BinaryDataModels
     */
    ModelStore.register(CubeModel,FrustrumModel)
    LiftRules.htmlProperties.default.set((r: Req) =>new Html5Properties(r.userAgent))
  }


  /**
   * Force the request to be UTF-8
   */
  private def makeUtf8(req: HTTPRequest) {
    req.setCharacterEncoding("UTF-8")
  }
}
