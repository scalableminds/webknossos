package controllers

import play.api.mvc._
import play.api.Play.current

object Stacks extends controllers.Controller {
  val stackPath = current.configuration.getString("braingames.stackPath").get

  def image(stackName: String, taskId: String, imageName: String) = {
    controllers.Assets.at(
      path = stackPath,
      file = "%s/stacks/%s/%s".format(stackName, taskId, imageName))
  }

}