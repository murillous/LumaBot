// Plugin local do TypeDoc: dá a cada módulo o nome do import público (`@zapforge/core/adapter`)
// em vez do caminho do arquivo (`core/src/adapter`). O nome sai dos `exports` de cada
// package.json, fonte única das entradas públicas; entrada sem export ou export sem entrada vira
// warning, e o build (com `treatWarningsAsErrors`) falha até a lista do typedoc.json acompanhar.
import { readdirSync, readFileSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { Converter, ReflectionKind } from 'typedoc';

const packagesDir = resolve(import.meta.dirname, '../../packages');

function publicEntries() {
  const entries = new Map();
  for (const dir of readdirSync(packagesDir)) {
    const pkg = JSON.parse(readFileSync(join(packagesDir, dir, 'package.json'), 'utf8'));
    for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
      const source = conditions['@zapforge/source'];
      if (source === undefined) continue;
      const file = resolve(packagesDir, dir, source);
      entries.set(file, pkg.name + subpath.slice(1));
    }
  }
  return entries;
}

export function load(app) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    const entries = publicEntries();
    const documented = new Set();
    for (const module of context.project.getChildrenByKind(ReflectionKind.Module)) {
      // O TypeDoc devolve o caminho com `/`; o `resolve` acima, com o separador do sistema.
      const source = module.sources?.[0]?.fullFileName;
      const file = source === undefined ? undefined : normalize(source);
      const name = file === undefined ? undefined : entries.get(file);
      if (name === undefined) {
        app.logger.warn(`Módulo ${module.name} não corresponde a nenhum export público.`);
        continue;
      }
      module.name = name;
      documented.add(file);
    }
    for (const [file, name] of entries) {
      if (!documented.has(file)) app.logger.warn(`Export ${name} ausente dos entryPoints.`);
    }
  });
}
