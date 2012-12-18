package mvc

import play.api.mvc.Results.{Status => HttpStatus}

object Status {
  val UnprocessableEntity = new HttpStatus(422)
}