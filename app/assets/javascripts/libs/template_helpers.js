import utils from "./utils";


const TemplateHelpers = {

  COLOR_MAP : ["#6962C5", "#403C78", "#B2B1C4", "#6D6C78", "#C4C4C4", "#FF5000", "#899AC4", "#523C78"],

  stringToColor(role) {

    const hash = this.hashString(role);
    return this.COLOR_MAP[hash];
  },


  hashString(string) {

    let hash = 0;
    for (let i of string) {
      hash += string.charCodeAt(i);
    }

    return hash % this.COLOR_MAP.length;
  },


  formatScale(scaleArr) {
    if (__guard__(scaleArr, x => x.length) > 0) {
      const scaleArrRounded = scaleArr.map(value => utils.roundTo(value, 2));
      return `(${scaleArrRounded.join(', ')})`;
    } else {
      return "";
    }
  }
};

export default TemplateHelpers;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}