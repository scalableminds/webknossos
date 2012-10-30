package controllers

import play.api._
import play.api.mvc._
import play.api.data._
import play.api.Play.current
import models._
import views._
import play.mvc.Results.Redirect
import play.api.data.Forms._
import models._
import play.api.libs.iteratee.Done
import play.api.libs.iteratee.Input
import brainflight.security.Secured
import brainflight.mail._
import controllers.admin._
import play.api.libs.concurrent.Akka
import akka.actor.Props

object Application extends Controller with Secured{

  // -- Authentication

  val Mailer = Akka.system.actorOf( Props[Mailer], name = "mailActor" )
  
  def index = Authenticated { implicit request =>
    Ok( html.oxalis.index(request.user) )
  }

  val registerForm: Form[( String, String, String )] = {
    def registerFormApply( user: String, name: String, password: Tuple2[String, String] ) =
      ( user, name, password._1 )
    def registerFormUnapply( user: Tuple3[String, String, String] ) =
      Some( ( user._1, user._2, ( "", "" ) ) )

    val passwordField = tuple( "main" -> text, "validation" -> text )
      .verifying( "Passwords don't match", pw => pw._1 == pw._2 )
      .verifying( "Password too short", pw => pw._1.length >= 6 )

    Form(
      mapping(
        "email" -> email,
        "name" -> text,
        "password" -> passwordField )( registerFormApply )( registerFormUnapply )
        .verifying( "This email address is already in use",
          user => User.findLocalByEmail( user._1 ).isEmpty ) )
  }

  def register = Action {
    implicit request =>
      Ok( html.user.register( registerForm ) )
  }

  /**
   * Handle registration form submission.
   */
  def registrate = Action {
    implicit request =>
      registerForm.bindFromRequest.fold(
        formWithErrors => BadRequest( html.user.register( formWithErrors ) ),
        {
          case ( email, name, password ) => {
            val user = User.create( email, name, password )
            val key = ValidationKey.createFor( user )
           Mailer ! Send( DefaultMails.registerMail( name, email, key ) )
            Redirect( routes.Application.index )
              .flashing( "success" -> "Thanks for your registration!" )
              .withSession( Secured.createSession( user ) )
          }
        } )
  }

  val loginForm = Form(
    tuple(
      "email" -> text,
      "password" -> text ) verifying ( "Invalid email or password", result => result match {
        case ( email, password ) =>
          User.auth( email, password ).isDefined
      } ) )

  /**
   * Login page.
   */
  def login = Action {
    implicit request =>
      Ok( html.user.login( loginForm ) )
  }

  /**
   * Handle login form submission.
   */
  def authenticate = Action {
    implicit request =>
      loginForm.bindFromRequest.fold(
        formWithErrors =>
          BadRequest( html.user.login( formWithErrors ) ),
        userForm => {
          val user = User.findLocalByEmail( userForm._1 ).get
          Redirect( routes.Application.index )
            .withSession( Secured.createSession( user ) )
        } )
  }

  /**
   * Logout and clean the session.
   */
  def logout = Action {
    Redirect( routes.Application.login )
      .withNewSession
      .flashing("success" -> "You've been logged out" )
  }

  // -- Javascript routing

  def javascriptRoutes = Action { implicit request =>
    Ok(
      Routes.javascriptRouter( "jsRoutes" )( //fill in stuff which should be able to be called from js
          controllers.admin.routes.javascript.NMLIO.upload, 
          controllers.admin.routes.javascript.NMLIO.downloadList
      ) ).as( "text/javascript" )
  }

}

