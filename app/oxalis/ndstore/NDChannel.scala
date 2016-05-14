/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.braingames.binary.models.DataLayer
import play.api.data.validation.ValidationError
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsResult, JsValue, _}

case class NDChannel(name: String, dataType: String, channelType: String)

object NDChannels {

  object NDChannelsReads extends Reads[List[NDChannel]] {
    val channelBodyReads =
      ((__ \ 'datatype).read[String].filter(
        ValidationError("ndstore.invalid.data.type"))(DataLayer.isValidElementClass) and
        (__ \ 'channel_type).read[String].filter(
          ValidationError("ndstore.invalid.channel.type"))(ND2WK.channelTypeMapping.contains)).tupled

    override def reads(json: JsValue): JsResult[List[NDChannel]] = {
      json.validate(Reads.mapReads(channelBodyReads)).map { jso =>
        jso.map {
          case (name, (dataType, channelType)) =>
            NDChannel(name, dataType, channelType)
        }.toList
      }
    }
  }

}
