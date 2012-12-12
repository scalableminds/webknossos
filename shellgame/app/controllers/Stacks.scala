package controllers

import play.api.mvc._
import play.api.Play.current

object Stacks extends controllers.Controller {
  val stackPath = current.configuration.getString("braingames.stackPath").get

  def image(stackName: String, stackNumber: Int, imageName: String) =
    controllers.Assets.at(
      path = stackPath,
      file = "%s/stacks/%d/%s".format(stackName, stackNumber, imageName))

}