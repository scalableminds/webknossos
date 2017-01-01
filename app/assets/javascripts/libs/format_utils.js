import _ from "lodash";
import moment from "moment";

class FormatUtils {

  static formatSeconds(seconds) {

    let days, hours, minutes;
    const t = moment.duration({seconds});
    [ days, hours, minutes, seconds ] = [ t.days(), t.hours(), t.minutes(), t.seconds() ];

    return (
      days === 0 && hours === 0 && minutes === 0 ?
        `${seconds}s`
      : days === 0 && hours === 0 ?
        `${minutes}m ${seconds}s`
      : days === 0 ?
        `${hours}h ${minutes}m ${seconds}s`
      :
        `${days}d ${hours}h ${minutes}m ${seconds}s`
    );
  }


  static formatHash(id) {

    return id.slice(-6);
  }


  static formatShortText(text, maxLength) {

    if (maxLength == null) { maxLength = 100; }
    if (text.length > maxLength && maxLength > 4) {
      return text.slice(0, maxLength - 4) + " ...";
    } else {
      return text;
    }
  }


  /**
   * Return current date and time
   */
  static formatDate() {

    return moment().format("YYYY-MM-DD HH:mm");
  }
}

export default FormatUtils;
