import _ from "lodash";
export type ShaderModule = {
  requirements?: ShaderModule[];
  code: string;
};

function gatherAllModules(
  modules: ShaderModule[],
  allModules: ShaderModule[] = [],
  visited: Set<ShaderModule> = new Set(),
): ShaderModule[] {
  for (const module of modules) {
    let push = false;

    if (!visited.has(module)) {
      visited.add(module);
      push = true;
    }

    (module.requirements || []).forEach((dep) => {
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

export default function compile(...requirements: (ShaderModule | null | undefined)[]): string {
  const allModules = gatherAllModules(_.compact(requirements));
  return allModules.map((m) => m.code).join("\n\n");
}
