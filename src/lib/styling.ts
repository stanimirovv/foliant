// Arrow style resolution and SVG post-processing (EDITING_PLAN.md 4.6, 4.9).
// Styles are STORED in CONFIG.arrows against RAW endpoints, but RESOLVED
// against post-transform actor names, so they follow the rules of merging.

import { ActorTransformOptions, buildActorRewriteMap } from './preprocessor';
import { DiagramConfig } from './views';

// Map every arrows[].from/to through the same actor-rewrite map transformActors
// uses. Entries whose endpoints were hidden are kept as-is: they are inert,
// because the arrows themselves are gone with the hidden actors.
export function rewriteArrowStyles(config: DiagramConfig | null, options: ActorTransformOptions): DiagramConfig | null {
  if (!config || !config.arrows || config.arrows.length === 0) return config;
  const { rename } = buildActorRewriteMap(config, options);
  if (rename.size === 0) return config;

  let changed = false;
  const arrows = config.arrows.map(a => {
    const from = rename.get(a.from) ?? a.from;
    const to = rename.get(a.to) ?? a.to;
    if (from !== a.from || to !== a.to) changed = true;
    return { ...a, from, to };
  });
  if (!changed) return config;
  return { ...config, arrows };
}
