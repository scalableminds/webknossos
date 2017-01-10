import $ from "jquery";
import _ from "lodash";

const Utils = {


  clamp(a, x, b) {
    return Math.max(a, Math.min(b, x));
  },


  zeroPad(num, zeros = 0) {
    num = `${num}`;
    while (num.length < zeros) {
      num = `0${num}`;
    }
    return num;
  },


  unflatten(array, tupleSize) {
    const result = [];
    for (let i = 0; i < array.length; i += tupleSize) {
      result.push(array.slice(i, i + tupleSize));
    }
    return result;
  },


  // sums up an array
  sum(array, iterator) {
    if (_.isString(iterator) || _.isNumber(iterator)) {
      return array.reduce(((r, a) => r + a[iterator]), 0);
    } else {
      return array.reduce(((r, a) => r + a), 0);
    }
  },


  roundTo(value, digits) {
    const digitMultiplier = Math.pow(10, digits);
    return Math.round(value * digitMultiplier) / digitMultiplier;
  },


  intToHex(int, digits = 6) {
    return (_.repeat("0", digits) + int.toString(16)).slice(-digits);
  },


  rgbToHex(color) {
    return `#${color.map(int => Utils.intToHex(int, 2)).join("")}`;
  },


  hexToRgb(hex) {
    const bigint = parseInt(hex.slice(1), 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;

    return [r, g, b];
  },


  compareBy(key, isSortedAscending = true) {
    // generic key comparator for array.prototype.sort

    return function (a, b) {
      if (!isSortedAscending) {
        [a, b] = [b, a];
      }
      if (a[key] < b[key]) {
        return -1;
      }
      if (a[key] > b[key]) {
        return 1;
      }
      return 0;
    };
  },


  stringToNumberArray(s) {
    // remove leading/trailing whitespaces
    s = s.trim();
    // replace remaining whitespaces with commata
    s = s.replace(/,?\s+,?/g, ",");
    const stringArray = s.split(",");

    const result = [];
    for (const e of stringArray) {
      const newEl = parseFloat(e);
      if (!isNaN(newEl)) {
        result.push(newEl);
      }
    }

    return result;
  },


  loaderTemplate() {
    return `\
<div id="loader-icon">
  <i class="fa fa-spinner fa-spin fa-4x"></i>
  <br>Loading
</div>`;
  },


  isElementInViewport(el) {
    // special bonus for those using jQuery
    if (typeof $ === "function" && el instanceof $) {
      el = el[0];
    }


    const rect = el.getBoundingClientRect();

    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  },


  // this is insecure and must not be used for security related functionality
  isUserAdmin(user) {
    if (user == null) {
      return false;
    } else {
      return _.findIndex(user.get("teams"), team => team.role.name === "admin") >= 0;
    }
  },


  getUrlParams(paramName) {
    // Parse the URL parameters as objects and return it or just a single param
    const params = window.location.search.substring(1).split("&").reduce((result, value) => {
      const parts = value.split("=");
      if (parts[0]) {
        const key = decodeURIComponent(parts[0]);
        value = parts[1] ? decodeURIComponent(parts[1]) : true;
        result[key] = value;
      }
      return result;
    }
    , {});

    if (paramName) { return params[paramName]; } else { return params; }
  },
};

export default Utils;
