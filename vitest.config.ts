import { globSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from 'vitest/config';

// Um projeto por pacote do workspace, o `bench/` inclusive. Projetos inline herdam esta config
// (extends: true); por glob ('packages/*') não herdariam o resolve abaixo.
const projects = globSync(['{packages,plugins,apps}/*/package.json', 'bench/package.json']).map(
  (manifest) => {
    const { name } = JSON.parse(readFileSync(manifest, 'utf8')) as { name: string };
    return { test: { name, root: dirname(manifest) } };
  },
);

export default defineConfig({
  // Resolve @zapforge/* direto no src/ (condição de exports), sem build antes dos testes.
  // (resolve vale para ambientes de browser/jsdom; ssr para o ambiente node, o padrão).
  resolve: { conditions: ['@zapforge/source'] },
  ssr: { resolve: { conditions: ['@zapforge/source'] } },
  test: {
    passWithNoTests: true,
    // Sem pacotes ainda, não há o que rodar (e o include padrão pegaria os testes de legacy/).
    ...(projects.length > 0 ? { projects } : { include: [] }),
  },
});
