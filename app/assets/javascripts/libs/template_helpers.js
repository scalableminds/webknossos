import Utils from "./utils";


const TemplateHelpers = {

  COLOR_MAP: ["#6962C5", "#403C78", "#B2B1C4", "#6D6C78", "#C4C4C4", "#FF5000", "#899AC4", "#523C78"],

  stringToColor(role) {
    const hash = this.hashString(role);
    return this.COLOR_MAP[hash];
  },


  hashString(string) {
    let hash = 0;
    for (const i of string) {
      hash += string.charCodeAt(i);
    }

    return hash % this.COLOR_MAP.length;
  },

  formatTuple(tuple) {
    if (Utils.__guard__(tuple, x => x.length) > 0) {
      const tupleRounded = tuple.map(value => Utils.roundTo(value, 2));
      return `(${tupleRounded.join(", ")})`;
    } else {
      return "";
    }
  },

  formatScale(scaleArr) {
    if (Utils.__guard__(scaleArr, x => x.length) > 0) {
      const scaleArrRounded = scaleArr.map(value => Utils.roundTo(value, 2));
      return `${scaleArrRounded.join(" × ")} nm³`;
    } else {
      return "";
    }
  },
};

export default TemplateHelpers;
