/*
 * Copyright (C) 20011-2014 Scalable minds UG (haftungsbeschränkt) & Co. KG. <http://scm.io>
 */
package oxalis.ndstore

import com.scalableminds.webknossos.datastore.models.datasource.{Category, ElementClass}
import play.api.data.validation.ValidationError
import play.api.libs.functional.syntax._
import play.api.libs.json.{JsResult, JsValue, _}

case class NDChannel(name: String, dataType: ElementClass.Value, channelType: Category.Value)

object NDChannels {

  object NDChannelsReads extends Reads[List[NDChannel]] {
    val channelBodyReads =
      ((__ \ 'datatype).read[ElementClass.Value] and
        (__ \ 'channel_type).read[String]
          .filter(ValidationError("ndstore.invalid.channel.type"))(ND2WK.channelTypeMapping.contains)
          .map(ND2WK.channelTypeMapping.get(_).get)
        ).tupled

    override def reads(json: JsValue): JsResult[List[NDChannel]] = {
      json.validate(Reads.mapReads(channelBodyReads)).map { (jso: Map[String, (ElementClass.Value, Category.Value)]) =>
        jso.map {
          case (name, (dataType, channelType)) =>
            NDChannel(name, dataType, channelType)
        }.toList
      }
    }
  }

}
