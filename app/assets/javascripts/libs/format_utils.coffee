_      = require("lodash")
moment = require("moment")

class FormatUtils

  @formatSeconds : (seconds) ->

    t = moment.duration(seconds: seconds)
    [ days, hours, minutes, seconds ] = [ t.days(), t.hours(), t.minutes(), t.seconds() ]

    return (
      if  days == 0 and hours == 0 and minutes == 0
        "#{seconds}s"
      else if days == 0 and hours == 0
        "#{minutes}m #{seconds}s"
      else if days == 0
        "#{hours}h #{minutes}m #{seconds}s"
      else
        "#{days}d #{hours}h #{minutes}m #{seconds}s"
    )


  @formatHash : (id) ->

    return id.slice(-6)


  @formatShortText : (text, maxLength = 100) ->

    if text.length > maxLength and maxLength > 4
      text.slice(0, maxLength - 4) + " ..."
    else
      text


  ###*
   * Return current date and time
   ###
  @formatDate : ->

    return moment().format("YYYY-MM-DD HH:mm")

module.exports = FormatUtils
