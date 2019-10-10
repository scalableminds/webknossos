package com.scalableminds.webknossos.tracingstore.tracings.skeleton.updating

import play.api.libs.json.Json

case class UpdateActionDiameterProperties(xRadius: Double,
                                          yRadius: Double,
                                          scaledXRadius: Double,
                                          scaledYRadius: Double,
                                          rotationAngle: Double)

object UpdateActionDiameterProperties { implicit val jsonFormat = Json.format[UpdateActionDiameterProperties] }
