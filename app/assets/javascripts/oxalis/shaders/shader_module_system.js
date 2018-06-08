// @flow
import _ from "lodash";

export type ShaderModuleType = {
  requirements?: ShaderModuleType[],
  code: string,
};

function gatherAllModules(
  modules: ShaderModuleType[],
  allModules: ShaderModuleType[] = [],
  visited: Set<ShaderModuleType> = new Set(),
): ShaderModuleType[] {
  for (const module of modules) {
    let push = false;
    if (!visited.has(module)) {
      visited.add(module);
      push = true;
    }
    (module.requirements || []).forEach(dep => {
      if (!visited.has(dep)) {
        visited.add(dep);
        gatherAllModules(dep.requirements || [], allModules, visited);
        allModules.push(dep);
      }
    });
    if (push) {
      allModules.push(module);
    }
  }
  return allModules;
}

export default function compile(...requirements: (?ShaderModuleType)[]): string {
  const allModules = gatherAllModules(_.compact(requirements));
  return allModules.map(m => m.code).join("\n\n");
}
