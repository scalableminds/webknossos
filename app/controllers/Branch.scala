package controllers

import brainflight.security.Secured
import play.api.mvc.Controller
import models.User
import models.TransformationMatrix
import models.Role
import models.Permission
import brainflight.tools.ExtendedDataTypes._
import play.api.mvc.Action
import play.api.mvc.Request
import play.api.libs.json.Json._
import play.api.libs.json._
import models.TrackedRoute

object Branch extends Controller with Secured {
  override val DefaultAccessRole = Role( "user" )

  def push = Authenticated() { user =>
    implicit request =>
      request.body.asRaw match {
        case Some( binRequest ) =>
          val binMatrix = binRequest.asBytes().getOrElse( Array[Byte]() )
          val branchMatrix = binMatrix.subDivide( 4 ).map( _.reverse.toFloat )
          User.save( user.copy( branchPoints = TransformationMatrix(branchMatrix.toList) :: user.branchPoints ) )
          TrackedRoute.findOpenBy( user ) foreach { flightRoute =>
            flightRoute.addBranch()
          }
          Ok
        case _ =>
          BadRequest( "Request needs to be binary" )
      }
  }

  def pop = Authenticated() { user =>
    implicit request =>
      if ( !user.branchPoints.isEmpty ){
        val branchPoint = user.branchPoints.head
        User.save( user.copy( branchPoints = user.branchPoints.tail ) )
        TrackedRoute.findOpenBy( user ) foreach { flightRoute =>
            flightRoute.closeBranch( branchPoint.extractTranslation.get.toVector3I )
        }
      }
      Ok
  }

  def list = Authenticated() { user =>
    implicit request =>
      val points: List[List[Float]] = user.branchPoints.map(_.value)
      Ok( toJson( points ) )
  }

  def clear = Authenticated() { user =>
    implicit request =>
      User.save( user.copy( branchPoints = Nil ) )
      Ok
  }
}