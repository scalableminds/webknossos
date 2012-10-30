package mvc

import play.api.mvc.Results.Status

object Status {
  val UnprocessableEntity = new Status(422)
}