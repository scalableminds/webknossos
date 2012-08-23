import brainflight.tools.geometry._
import play.api._
import play.api.Play.current
import models._
import brainflight.mail.DefaultMails

object Global extends GlobalSettings {

  override def onStart( app: Application ) {
//    if ( Play.current.mode == Mode.Dev )
      InitialData.insert()
  }

}

/**
 * Initial set of data to be imported
 * in the sample application.
 */    
object InitialData {

  def insert() = {
    if ( DataSet.findAll.isEmpty ) {
      DataSet.insert( DataSet(
        "2012-06-28_Cortex",
        Play.configuration.getString( "binarydata.path" ) getOrElse ( "binaryData/" )+"2012-06-28_Cortex",
        List( 0, 1, 2, 3 ),
        Point3D(24 * 128, 16 * 128, 8 * 128) ) )

    }

    if ( User.findAll.isEmpty ) {
      val u = ( "scmboy@scalableminds.com", "SCM Boy", "secret" )
      Seq(
        u ).foreach( User.create _ tupled )
    }

    if ( Role.findAll.isEmpty ) {
      Role.insert( Role( "user", Nil ) )
      Role.insert( Role( "admin", Permission( "*", "*" :: Nil ) :: Nil ) )
    }

    if ( RouteOrigin.findAll.isEmpty ) {
      val d = DataSet.default
      val matrix = List[Float]( 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 300, 300, 200, 1 )
      RouteOrigin.insert( RouteOrigin( TransformationMatrix( matrix ), 0, d._id ) )
    }
  }

}
