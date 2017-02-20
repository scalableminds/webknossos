/*
 * format_utils.js
 * @flow
 */
import moment from "moment";

class FormatUtils {

  static formatSeconds(durationSeconds: number): string {
    const t = moment.duration(durationSeconds, "seconds");
    const [days, hours, minutes, seconds] = [t.days(), t.hours(), t.minutes(), t.seconds()];

    let timeString;
    if (days === 0 && hours === 0 && minutes === 0) {
      timeString = `${seconds}s`;
    } else if (days === 0 && hours === 0) {
      timeString = `${minutes}m ${seconds}s`;
    } else if (days === 0) {
      timeString = `${hours}h ${minutes}m ${seconds}s`;
    } else {
      timeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;
    }
    return timeString;
  }


  static formatHash(id: string): string {
    return id.slice(-6);
  }


  static formatShortText(text: string, maxLength: number = 100): string {
    if (text.length > maxLength && maxLength > 4) {
      return `${text.slice(0, maxLength - 4)} ...`;
    }
    return text;
  }


  /**
   * Return current date and time
   */
  static formatDate(): string {
    return moment().format("YYYY-MM-DD HH:mm");
  }
}

export default FormatUtils;
