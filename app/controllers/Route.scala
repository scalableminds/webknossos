package controllers

import play.api.Logger
import play.api.libs.json.Json._
import play.api.libs.json._
import models.{ TrackedRoute, RouteOrigin, BranchPoint }
import play.api.mvc._
import org.bson.types.ObjectId
import brainflight.tools.Math._
import brainflight.security.Secured
import brainflight.tools.geometry.Vector3I
import brainflight.tools.geometry.Vector3I._
import brainflight.tools.ExtendedTypes._
import models.{ User, TransformationMatrix }
import models.Role
import models.Origin

/**
 * scalableminds - brainflight
 * User: tmbo
 * Date: 19.12.11
 * Time: 11:27
 */
object Route extends Controller with Secured {
  override val DefaultAccessRole = Role( "user" )

  val PointValue = 0f
  val BranchPushVallue = 1f
  val BranchPopValue = 2f
  
  def initialize( dataSetId: String ) = Authenticated() { user =>
    implicit request =>
      val originOption:Option[Origin] = 
        (user.useBranchPointAsOrigin) orElse (RouteOrigin.useLeastUsed( dataSetId ))
      ( for {
        origin <- originOption
        startPoint <- origin.matrix.extractTranslation
      } yield {
        val route = TrackedRoute.createForUser(
          user,
          dataSetId,
          startPoint.toVector3I :: Nil )

        val data = Json.obj(
          "id" -> route.id,
          "matrix" -> origin.matrix.value, 
          "branches" -> user.branchPoints.map( _.matrix.value).reverse 
        )
        
        Ok( data )
      } ) getOrElse NotFound( "Couldn't open new route." )
  }
  /**
   *
   */
  def blackBox( id: String ) = Authenticated( parser = parse.raw( 1024 * 1024 ) ) { user =>
    implicit request =>

      ( for {
        route <- TrackedRoute.findOpenBy( id )
        buffer <- request.body.asBytes( 1024 * 1024 )
        if ( route.userId == user._id )
      } yield {
        var points = Vector.empty[Vector3I]
        
        val floatBuffer = buffer.subDivide( 4 ).map( _.reverse.toFloat )
        Logger.debug("Route received")
        floatBuffer.dynamicSliding( windowSize = 17 ) {
          case PointValue :: x :: y :: z :: _ =>
            val v = Vector3I( x.toInt, y.toInt, z.toInt )
            points = points :+ v
            
            Vector3I.defaultSize
          case BranchPushVallue :: tail =>
            val matrix = tail.take(16)
            Logger.debug("PUSH branchpoint: "+matrix)
            route.add( points.toList )
            points = Vector.empty
            User.save( user.copy( branchPoints = BranchPoint( matrix ) :: user.branchPoints ) )
            route.addBranch()
            
            TransformationMatrix.defaultSize
          case BranchPopValue :: _ =>
            Logger.debug("POP branchpoint")
            route.add( points.toList )
            points = Vector.empty
            if ( !user.branchPoints.isEmpty ) {
              val branchPoint = user.branchPoints.head
              User.save( user.copy( branchPoints = user.branchPoints.tail ) )
              route.closeBranch( branchPoint.matrix.extractTranslation.get.toVector3I )
            }
            
            0
          case _ =>
            Logger.error("Recieved control code is invalid.")     
            floatBuffer.size // jump right to the end to stop processing
        }
        route.add( points.toList )
        Ok
      } ) getOrElse BadRequest( "No open route found or byte array invalid." )

  }
  def list = Authenticated() { user =>
    implicit request =>
      val routes = TrackedRoute.findByUser( user )
      Ok( toJson( routes.map( _.points ) ))
  }
  
  def getRoute( id: String ) = Authenticated() { user =>
    implicit request =>
      TrackedRoute.findOneByID( new ObjectId( id ) ).map( route =>
        Ok( toJson( route.points ) )
      ) getOrElse NotFound( "Couldn't open route." )
  }
}