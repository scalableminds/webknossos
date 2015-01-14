### define
underscore : _
moment : moment
###

class FormatUtils

  @formatSeconds : (seconds) ->

    t = moment.duration(seconds: seconds)
    [ days, hours, minutes ] = [ t.days(), t.hours(), t.minutes() ]

    return (
      if days == 0 and hours == 0
        "#{minutes}m"
      else if days == 0
        "#{hours}h #{minutes}m"
      else
        "#{days}d #{hours}h #{minutes}m"
    )


  @formatHash : (id) ->

    return id.slice(0, 6)


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