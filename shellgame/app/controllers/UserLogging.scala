package controllers

import play.api.mvc._
import java.io.File
import java.io.FileWriter
import play.api.Play.current
import play.api.mvc.BodyParsers._

object UserLogging extends controllers.Controller{
  val shellgameAssetsPath =
    current.configuration.getString("shellgame.shellgameAssetsPath").get

  val LOG_FILES_ROOT = shellgameAssetsPath + "userlogs"

  def writeToFile(fileName: String, content: String, append: Boolean = true): Boolean = {
    writeToFile(new File(fileName), content, append)
  }

  def writeToFile(file: File, content: String, append: Boolean): Boolean = {
    try {
      val fw = new FileWriter(file, append)
      fw.write(content)
      fw.close()
      true
    } catch {
      case e: java.io.FileNotFoundException =>
        println("Writing to file failed: " + e.getMessage())
        false
    }
  }

  def log(id: String) = Action(parse.urlFormEncoded) { implicit request =>
    if (id.matches("^[a-zA-Z0-9]*$")) {
      postParameter("log") match {
        case Some(log) =>
          if (writeToFile("%s/%s.log".format(LOG_FILES_ROOT, id), log.mkString("", "\n", "\n")))
            Ok
          else
            BadRequest("Write to file failed.")
        case _ =>
          BadRequest("'log' parameter missing.")
      }
    } else {
      BadRequest("Invalid id.")
    }
  }
}