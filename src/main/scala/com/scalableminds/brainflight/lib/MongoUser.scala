package com.scalableminds.brainflight.lib

import net.liftweb.http.{js, S, SHtml, SessionVar, RequestVar, CleanRequestVarOnSessionTransition}
import js._
import JsCmds._
import S._
import SHtml._

import net.liftweb.sitemap._
import net.liftweb.sitemap.Loc._
import net.liftweb.util.Helpers._
import net.liftweb.util._
import net.liftweb.common._
import net.liftweb.record.field._
import net.liftweb.mongodb._
import net.liftweb.mongodb.record._
import net.liftweb.mongodb.record.field.MongoPasswordField
import net.liftweb.util.Mailer._
import net.liftweb.json.DefaultFormats
import net.liftweb.json.JsonDSL._
import net.liftweb.json.JsonAST.JObject
import net.liftweb.mongodb.record.field._
import com.scalableminds.brainflight.lib._

import scala.xml.{NodeSeq, Node, Text, Elem}
import scala.xml.transform._

import com.mongodb._

trait MetaMegaProtoUser[ModelType <: MegaProtoUser[ModelType]] extends MongoMetaRecord[ModelType] {
  self: ModelType =>

  import net.liftweb.json.JsonDSL._

  ensureIndex(("email" -> 1), true) // unique email

  def signupFields = firstName :: email :: password :: Nil

  override def fieldOrder = firstName :: email :: password :: Nil

  def meta: MetaMegaProtoUser[ModelType]

  def screenWrap: Box[Node] = Empty

  val basePath: List[String] = "user_mgt" :: Nil
  def signUpSuffix = "sign_up"
  lazy val signUpPath = thePath(signUpSuffix)
  def loginSuffix = "login"
  lazy val loginPath = thePath(loginSuffix)
  def lostPasswordSuffix = "lost_password"
  lazy val lostPasswordPath = thePath(lostPasswordSuffix)
  def passwordResetSuffix = "reset_password"
  lazy val passwordResetPath = thePath(passwordResetSuffix)
  def changePasswordSuffix = "change_password"
  lazy val changePasswordPath = thePath(changePasswordSuffix)
  def logoutSuffix = "logout"
  lazy val logoutPath = thePath(logoutSuffix)
  def editSuffix = "edit"
  lazy val editPath = thePath(editSuffix)
  def validateUserSuffix = "validate_user"
  lazy val validateUserPath = thePath(validateUserSuffix)

  def homePage = "/"

  object loginRedirect extends SessionVar[Box[String]](Empty)

  case class MenuItem(name: String, path: List[String],
                      loggedIn: Boolean) {
    lazy val endOfPath = path.last
    lazy val pathStr: String = path.mkString("/", "/", "")
    lazy val display = name match {
      case null | "" => false
      case _ => true
    }
  }

  def thePath(end: String): List[String] = basePath ::: List(end)

  /**
  * Return the URL of the "login" page
  */
  def loginPageURL = loginPath.mkString("/","/", "")

  def notLoggedIn_? = !loggedIn_?

  lazy val testLogginIn = If(loggedIn_? _, S.??("must.be.logged.in")) ;

  lazy val testSuperUser = If(superUser_? _, S.??("must.be.super.user"))

  def loginFirst = If(
    loggedIn_? _,
    () => {
      import net.liftweb.http.{RedirectWithState, RedirectState}
      val uri = S.uriAndQueryString
      RedirectWithState(
        loginPageURL,
        RedirectState( ()=>{loginRedirect.set(uri)})
      )
    }
  )

  def superUser_? : Boolean = currentUser.map(_.superUser.value) openOr false

  /**
  * The menu item for login (make this "Empty" to disable)
  */
  def loginMenuLoc: Box[Menu] =
    Full(Menu(Loc("Login", loginPath, S.??("login"), loginMenuLocParams)))

  /**
  * The LocParams for the menu item for login.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def loginMenuLocParams: List[LocParam[Unit]] =
    If(notLoggedIn_? _, S.??("already.logged.in")) ::
  Template(() => wrapIt(login)) ::
  Nil

  /**
  * The menu item for logout (make this "Empty" to disable)
  */
  def logoutMenuLoc: Box[Menu] =
    Full(Menu(Loc("Logout", logoutPath, S.??("logout"), logoutMenuLocParams)))

  /**
  * The LocParams for the menu item for logout.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def logoutMenuLocParams: List[LocParam[Unit]] =
    Template(() => wrapIt(logout)) ::
  testLogginIn ::
  Nil

  /**
  * The menu item for creating the user/sign up (make this "Empty" to disable)
  */
  def createUserMenuLoc: Box[Menu] =
    Full(Menu(Loc("CreateUser", signUpPath, S.??("sign.up"), createUserMenuLocParams)))

  /**
  * The LocParams for the menu item for creating the user/sign up.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def createUserMenuLocParams: List[LocParam[Unit]] =
    Template(() => wrapIt(signupFunc.map(_()) openOr signup)) ::
  If(notLoggedIn_? _, S.??("logout.first")) ::
  Nil

  /**
  * The menu item for lost password (make this "Empty" to disable)
  */
  def lostPasswordMenuLoc: Box[Menu] =
    Full(Menu(Loc("LostPassword", lostPasswordPath, S.??("lost.password"), lostPasswordMenuLocParams))) // not logged in

  /**
  * The LocParams for the menu item for lost password.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def lostPasswordMenuLocParams: List[LocParam[Unit]] =
    Template(() => wrapIt(lostPassword)) ::
  If(notLoggedIn_? _, S.??("logout.first")) ::
  Nil

  /**
  * The menu item for resetting the password (make this "Empty" to disable)
  */
  def resetPasswordMenuLoc: Box[Menu] =
    Full(Menu(Loc("ResetPassword", (passwordResetPath, true), S.??("reset.password"), resetPasswordMenuLocParams))) //not Logged in

  /**
  * The LocParams for the menu item for resetting the password.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def resetPasswordMenuLocParams: List[LocParam[Unit]] =
    Hidden ::
  Template(() => wrapIt(passwordReset(snarfLastItem))) ::
  If(notLoggedIn_? _, S.??("logout.first")) ::
  Nil

  /**
  * The menu item for editing the user (make this "Empty" to disable)
  */
  def editUserMenuLoc: Box[Menu] =
    Full(Menu(Loc("EditUser", editPath, S.??("edit.user"), editUserMenuLocParams)))

  /**
  * The LocParams for the menu item for editing the user.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def editUserMenuLocParams: List[LocParam[Unit]] =
    Template(() => wrapIt(editFunc.map(_()) openOr edit)) ::
  testLogginIn ::
  Nil

  /**
  * The menu item for changing password (make this "Empty" to disable)
  */
  def changePasswordMenuLoc: Box[Menu] =
    Full(Menu(Loc("ChangePassword", changePasswordPath, S.??("change.password"), changePasswordMenuLocParams)))

  /**
  * The LocParams for the menu item for changing password.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def changePasswordMenuLocParams: List[LocParam[Unit]] =
    Template(() => wrapIt(changePassword)) ::
  testLogginIn ::
  Nil

  /**
  * The menu item for validating a user (make this "Empty" to disable)
  */
  def validateUserMenuLoc: Box[Menu] =
    Full(Menu(Loc("ValidateUser", (validateUserPath, true), S.??("validate.user"), validateUserMenuLocParams)))

  /**
  * The LocParams for the menu item for validating a user.
  * Overwrite in order to add custom LocParams. Attention: Not calling super will change the default behavior!
  */
  protected def validateUserMenuLocParams: List[LocParam[Unit]] =
    Hidden ::
  Template(() => wrapIt(validateUser(snarfLastItem))) ::
  If(notLoggedIn_? _, S.??("logout.first")) ::
  Nil

  /**
  * An alias for the sitemap property
  */
  def menus: List[Menu] = sitemap // issue 182

  lazy val sitemap: List[Menu] =
    List(loginMenuLoc, logoutMenuLoc, createUserMenuLoc,
        lostPasswordMenuLoc, resetPasswordMenuLoc,
        editUserMenuLoc, changePasswordMenuLoc,
        validateUserMenuLoc).flatten(a => a)


  def skipEmailValidation = false

  def userMenu: List[Node] = {
    val li = loggedIn_?
    ItemList.
    filter(i => i.display && i.loggedIn == li).
    map(i => (<a href={i.pathStr}>{i.name}</a>))
  }

  protected def snarfLastItem: String =
    (for (r <- S.request) yield r.path.wholePath.last) openOr ""

  lazy val ItemList: List[MenuItem] =
    List(MenuItem(S.??("sign.up"), signUpPath, false),
        MenuItem(S.??("log.in"), loginPath, false),
        MenuItem(S.??("lost.password"), lostPasswordPath, false),
        MenuItem("", passwordResetPath, false),
        MenuItem(S.??("change.password"), changePasswordPath, true),
        MenuItem(S.??("log.out"), logoutPath, true),
        MenuItem(S.??("edit.profile"), editPath, true),
        MenuItem("", validateUserPath, false))


  var onLogIn: List[ModelType => Unit] = Nil

  var onLogOut: List[Box[ModelType] => Unit] = Nil

  /**
  * This function is given a chance to log in a user
  * programmatically when needed
  */
  var autologinFunc: Box[()=>Unit] = Empty

  def loggedIn_? = {
    if(!currentUserId.isDefined)
      for(f <- autologinFunc) f()
    currentUserId.isDefined
  }

  def logUserIdIn(id: String) {
    curUser.remove()
    curUserId(Full(id))
  }
  def logUserIn(who: ModelType) {
    curUser.remove()
    curUserId(Full(who.id.toString))
    onLogIn.foreach(_(who))
  }

  def logoutCurrentUser = logUserOut()

  def logUserOut() {
    onLogOut.foreach(_(curUser))
    curUserId.remove()
    curUser.remove()
    S.request.foreach(_.request.session.terminate)
  }

  private object curUserId extends SessionVar[Box[String]](Empty)

  def currentUserId: Box[String] = curUserId.is

  private object curUser extends RequestVar[Box[ModelType]](currentUserId.flatMap(id => meta.find(id)))  with CleanRequestVarOnSessionTransition


  def currentUser: Box[ModelType] = curUser.is

  def signupXhtml(user: ModelType) = {
    (<form method="post" action={S.uri}>
        <table>
          <tr><td>{ S.??("sign.up") }</td></tr>
          {localForm(user, false)}
          <tr><td><user:submit/></td></tr>
        </table>
    </form>)
  }


  def signupMailBody(user: ModelType, validationLink: String) = {
    (<html>
        <head>
          <title>{S.??("sign.up.confirmation")}</title>
        </head>
        <body>
          <p>{S.??("dear")} {user.firstName},
            <br/>
            <br/>
            {S.??("sign.up.validation.link")}
            <br/><a href={validationLink}>{validationLink}</a>
            <br/>
            <br/>
            {S.??("thank.you")}
          </p>
        </body>
    </html>)
  }

  def signupMailSubject = S.??("sign.up.confirmation")

  def sendValidationEmail(user: ModelType) {
    val resetLink = S.hostAndPath + "/" + validateUserPath.mkString("/") + "/" + user.id

    val email: String = user.email.value

    val msgXml = signupMailBody(user, resetLink)

    Mailer.sendMail(From(emailFrom),Subject(signupMailSubject),
                    (To(user.email.value) :: xmlToMailBodyType(msgXml) ::
                    (bccEmail.toList.map(BCC(_)))) :_* )
  }

  protected object signupFunc extends RequestVar[Box[() => NodeSeq]](Empty)

  /**
  * Override this method to do something else after the user signs up
  */
  protected def actionsAfterSignup(theUser: ModelType) {
    theUser.validated.set(skipEmailValidation)
    theUser.save(true)
    if (!skipEmailValidation) {
      sendValidationEmail(theUser)
      S.notice(S.??("sign.up.message"))
    } else {
      S.notice(S.??("welcome"))
      logUserIn(theUser)
    }
  }

  /**
  * Override this method to validate the user signup (eg by adding captcha verification)
  */
  def validateSignup(user: ModelType): List[FieldError] = user.validate

  def signup = {
    val theUser: ModelType = createRecord
    val theName = signUpPath.mkString("")


    def testSignup() {
      validateSignup(theUser) match {
        case Nil =>
          actionsAfterSignup(theUser)
          S.redirectTo(homePage)

        case xs => S.error(xs) ; signupFunc(Full(innerSignup _))
        // case errs => errs foreach {e => S.error(e.msg)} ; signupFunc(Full(innerSignup _))
      }
    }

    def innerSignup = bind("user",
                          signupXhtml(theUser),
                          "submit" -> SHtml.submit(S.??("sign.up"), testSignup _))

    innerSignup
  }

  def emailFrom = "noreply@" + S.hostName

  def bccEmail: Box[String] = Empty

  def testLoggedIn(page: String): Boolean =
    ItemList.filter(_.endOfPath == page) match {
      case x :: xs if x.loggedIn == loggedIn_? => true
      case _ => false
    }


  def validateUser(id: String): NodeSeq = meta.find(id) match {
    case Full(user) if !user.validated.value =>
      user.validated.set(true)
      user.save
      S.notice(S.??("account.validated"))
      logUserIn(user)
      S.redirectTo(homePage)

    case _ => S.error(S.??("invalid.validation.link")); S.redirectTo(homePage)
  }

  def loginXhtml = {
    (<form method="post" action={S.uri}>
        <table>
          <tr><td
              colspan="2">{S.??("log.in")}</td></tr>
          <tr><td>{S.??("email.address")}</td><td><user:email /></td></tr>
          <tr><td>{S.??("password")}</td><td><user:password /></td></tr>
          <tr><td><a href={lostPasswordPath.mkString("/", "/", "")}
                >{S.??("recover.password")}</a></td><td><user:submit /></td></tr>
        </table>
    </form>)
  }

  def login = {
    if (S.post_?) {
      S.param("username").
      flatMap(username => meta.find(("email" -> username))) match {
        case Full(user) if user.validated.value &&
          user.password.isMatch(S.param("password").openOr("*")) =>
          S.notice(S.??("logged.in"))
          logUserIn(user)

          val redir = loginRedirect.is match {
            case Full(url) =>
              loginRedirect(Empty)
              url
            case _ =>
              homePage
          }
          S.redirectTo(redir)

        case Full(user) if !user.validated.value =>
          S.error(S.??("account.validation.error"))

        case _ => S.error(S.??("invalid.credentials"))
      }
    }

    bind("user", loginXhtml,
        "email" -> (FocusOnLoad(<input type="text" name="username"/>)),
        "password" -> (<input type="password" name="password"/>),
        "submit" -> (<input type="submit" value={S.??("log.in")}/>))
  }

  def lostPasswordXhtml = {
    (<form method="post" action={S.uri}>
        <table>
          <tr><td
              colspan="2">{S.??("enter.email")}</td></tr>
          <tr><td>{S.??("email.address")}</td><td><user:email /></td></tr>
          <tr><td>&nbsp;</td><td><user:submit /></td></tr>
        </table>
    </form>)
  }

  def passwordResetMailBody(user: ModelType, resetLink: String) = {
    (<html>
        <head>
          <title>{S.??("reset.password.confirmation")}</title>
        </head>
        <body>
          <p>{S.??("dear")} {user.firstName},
            <br/>
            <br/>
            {S.??("click.reset.link")}
            <br/><a href={resetLink}>{resetLink}</a>
            <br/>
            <br/>
            {S.??("thank.you")}
          </p>
        </body>
    </html>)
  }

  def passwordResetEmailSubject = S.??("reset.password.request")

  def sendPasswordReset(email: String) {
    meta.find(("email") -> email) match {
      case Full(user) if user.validated.value =>
        user.save
        val resetLink = S.hostAndPath +
        passwordResetPath.mkString("/", "/", "/") + user.id

        val email: String = user.email.value

        val msgXml = passwordResetMailBody(user, resetLink)
        Mailer.sendMail(From(emailFrom),Subject(passwordResetEmailSubject),
                        (To(user.email.value) :: xmlToMailBodyType(msgXml) ::
                        (bccEmail.toList.map(BCC(_)))) :_*)

        S.notice(S.??("password.reset.email.sent"))
        S.redirectTo(homePage)

      case Full(user) =>
        sendValidationEmail(user)
        S.notice(S.??("account.validation.resent"))
        S.redirectTo(homePage)

      case _ => S.error(S.??("email.address.not.found"))
    }
  }

  def lostPassword = {
    bind("user", lostPasswordXhtml,
        "email" -> SHtml.text("", sendPasswordReset _),
        "submit" -> <input type="submit" value={S.??("send.it")} />)
  }

  def passwordResetXhtml = {
    (<form method="post" action={S.uri}>
        <table>
          <tr><td colspan="2">{S.??("reset.your.password")}</td></tr>
          <tr><td>{S.??("enter.your.new.password")}</td><td><user:pwd/></td></tr>
          <tr><td>{S.??("repeat.your.new.password")}</td><td><user:pwd/></td></tr>
          <tr><td>&nbsp;</td><td><user:submit/></td></tr>
        </table>
    </form>)
  }

  def passwordReset(id: String) =
    meta.find(id) match {
      case Full(user) =>
        var newPassword: List[String] = Nil

        def finishSet() {
          if (newPassword.length != 2 || newPassword.head != newPassword(1))
            S.error(?("new.passwords.dont.match"))
          else {
            user.password.setPassword(newPassword.head)
            user.validate match {
              case Nil =>
                user.save
                logUserIn(user)
                S.notice(S.??("password.changed"))
                S.redirectTo(homePage)
              case xs => S.error(xs)
            }
          }
        }

        bind("user", passwordResetXhtml,
            "pwd" -> SHtml.password_*("", (p: List[String]) => newPassword = (p)),
            "submit" -> SHtml.submit(S.??("set.password"), finishSet _))
      case _ => S.error(S.??("password.link.invalid")); S.redirectTo(homePage)
    }

  def changePasswordXhtml = {
    (<form method="post" action={S.uri}>
        <table>
          <tr><td colspan="2">{S.??("change.password")}</td></tr>
          <tr><td>{S.??("old.password")}</td><td><user:old_pwd /></td></tr>
          <tr><td>{S.??("new.password")}</td><td><user:new_pwd /></td></tr>
          <tr><td>{S.??("repeat.password")}</td><td><user:new_pwd /></td></tr>
          <tr><td>&nbsp;</td><td><user:submit /></td></tr>
        </table>
    </form>)
  }

  def changePassword = {
    val user = currentUser.open_! // we can do this because the logged in test has happened
    var oldPassword = ""
    var newPassword: List[String] = Nil

    def testAndSet() {
      if (!user.password.isMatch(oldPassword))
        S.error(S.??("wrong.old.password"))
      else if (newPassword.length != 2 || newPassword.head != newPassword(1))
        S.error("New passwords don't match")
      else {
        user.password.setPassword(newPassword.head)
        user.validate match {
          case Nil => user.save
            S.notice(S.??("password.changed"))
            S.redirectTo(homePage)
          case xs => S.error(xs)
        }
      }
    }

    bind("user", changePasswordXhtml,
        "old_pwd" -> SHtml.password("", s => oldPassword = s),
        "new_pwd" -> SHtml.password_*("", LFuncHolder(s => newPassword = s)),
        "submit" -> SHtml.submit(S.??("change"), testAndSet _))
  }

  def editXhtml(user: ModelType) = {
    (<form method="post" action={S.uri}>
        <table><tr><td>{S.??("edit")}</td></tr>
          {localForm(user, true)}
          <tr><td><user:submit/></td></tr>
        </table>
    </form>)
  }

  object editFunc extends RequestVar[Box[() => NodeSeq]](Empty)

  def edit = {
    val theUser: ModelType = currentUser.open_! // we know we're logged in
    val theName = editPath.mkString("")

    def testEdit() {
      theUser.validate match {
        case Nil =>
          theUser.save
          S.notice(S.??("profile.updated"))
          S.redirectTo(homePage)

        case xs => S.error(xs) ; editFunc(Full(innerEdit _))
      }
    }

    def innerEdit = bind("user", editXhtml(theUser),
                        "submit" -> SHtml.submit(S.??("edit"), testEdit _))

    innerEdit
  }

  def logout = {
    logoutCurrentUser
    S.redirectTo(homePage)
  }

  protected def localForm(user: ModelType, ignorePassword: Boolean): NodeSeq = {
    signupFields.
    filter(f => !ignorePassword || (f match {
          case f: PasswordField[ModelType] => false
          case _ => true
        })).
    flatMap(f =>
      f.toForm.toList.map(form =>
        (<tr><td>{f.displayName}</td><td>{form}</td></tr>) ) )
  }

  protected def wrapIt(in: NodeSeq): NodeSeq =
    screenWrap.map(new RuleTransformer(new RewriteRule {
          override def transform(n: Node) = n match {
            case e: Elem if "bind" == e.label && "lift" == e.prefix => in
            case _ => n
          }
        })) openOr in
}

trait MegaProtoUser[T <: MegaProtoUser[T]] extends ProtoUser[T] {
  self: T =>

  object validated extends BooleanField[T](this)

}