// Resolving a participant drag-reorder against the PREPROCESSED diagram.
//
// The viewer computes drop positions in the rendered (processed) participant
// order, but edits apply to the RAW code — and transformActors regroups
// participants (uncolored first, then one box per color), so the rendered
// order is not the raw declaration order. "Insert X before Y" in raw order
// therefore does not necessarily put X before Y in the rendered diagram,
// which made extreme drops (before the first / after the last participant)
// land in the wrong place or silently do nothing.
//
// resolveParticipantReorder searches every single-line raw insertion for the
// one whose PROCESSED participant order best matches the drop intent, so the
// dragged participant always moves as far toward the drop position as the
// color grouping allows.
//
// Orders are compared by participant ID, not by model key: keys are positional
// (p:0, p:1, ...) and change meaning when a participant moves.

import { parseModel, ParticipantElement } from './model';
import { DiagramConfig } from './views';
import { moveParticipant, EditResult } from './editor';
import { buildSelectionMap } from './svgmap';
import {
  transformActors, processMermaid,
  ActorTransformOptions, PreprocessorOptions,
} from './preprocessor';

export interface ReorderContext {
  config: DiagramConfig | null;
  actorOptions: ActorTransformOptions;
  isRegionVisible: PreprocessorOptions['isRegionVisible'];
}

// The participant ids in rendered order (processed source order is the
// rendered left-to-right order). Each processed participant is mapped to its
// raw id through the selection map; processed participants without a raw
// counterpart keep their processed id (they never match a target id, so they
// only add a constant penalty to every candidate).
function processedOrderOf(
  rawCode: string,
  processedCode: string,
  ctx: ReorderContext,
): string[] {
  const map = buildSelectionMap(rawCode, processedCode, ctx.config, ctx.actorOptions);
  return parseModel(processedCode).elements
    .filter((e): e is ParticipantElement => e.kind === 'participant')
    .map(p => {
      const raw = map.get(p.key);
      return raw && raw.kind === 'participant' ? raw.id : p.id;
    });
}

// Run the same processing pipeline ClientPage uses for the viewer.
function processCode(rawCode: string, ctx: ReorderContext): string {
  const actorTransformed = transformActors(rawCode, ctx.config, ctx.actorOptions);
  return processMermaid(actorTransformed, { isRegionVisible: ctx.isRegionVisible }).code;
}

// Resolve a drag-reorder (processed keys, as reported by DiagramViewer) to
// the best raw edit. beforeProcessedKey === null means "drop at the end".
export function resolveParticipantReorder(
  rawCode: string,
  processedCode: string,
  fromProcessedKey: string,
  beforeProcessedKey: string | null,
  ctx: ReorderContext,
): EditResult {
  const { config } = ctx;
  const map = buildSelectionMap(rawCode, processedCode, config, ctx.actorOptions);
  const fromRaw = map.get(fromProcessedKey);
  if (!fromRaw || fromRaw.kind !== 'participant') {
    return { code: rawCode, config, warning: `Unknown participant key: ${fromProcessedKey}` };
  }
  const beforeRaw = beforeProcessedKey ? map.get(beforeProcessedKey) : undefined;
  if (beforeProcessedKey && (!beforeRaw || beforeRaw.kind !== 'participant')) {
    return { code: rawCode, config, warning: `Unknown participant key: ${beforeProcessedKey}` };
  }
  const fromId = fromRaw.id;
  const beforeId = beforeRaw && beforeRaw.kind === 'participant' ? beforeRaw.id : undefined;

  const rawParticipants = parseModel(rawCode).elements.filter(e => e.kind === 'participant');
  const currentOrder = processedOrderOf(rawCode, processedCode, ctx);

  // Target: the dragged participant right before `beforeId` (or at the end)
  // in rendered order.
  const targetOrder = [...currentOrder];
  const fromIdx = targetOrder.indexOf(fromId);
  if (fromIdx >= 0) targetOrder.splice(fromIdx, 1);
  let insertAt = beforeId !== undefined ? targetOrder.indexOf(beforeId) : -1;
  if (insertAt < 0) insertAt = targetOrder.length;
  targetOrder.splice(insertAt, 0, fromId);

  // Score a candidate's rendered order against the target:
  //   1. how far the dragged participant is from its target position
  //   2. total displacement of all participants (stability)
  //   3. prefer the no-op edit (no raw rewrite when nothing can move)
  const scoreOf = (order: string[], noOp: boolean): [number, number, number] => {
    const fromPos = order.indexOf(fromId);
    const primary = fromPos < 0
      ? targetOrder.length + 1
      : Math.abs(fromPos - targetOrder.indexOf(fromId));
    let secondary = 0;
    for (const id of targetOrder) {
      const i = order.indexOf(id);
      secondary += i < 0 ? targetOrder.length : Math.abs(i - targetOrder.indexOf(id));
    }
    return [primary, secondary, noOp ? 0 : 1];
  };

  let best: { result: EditResult; score: [number, number, number] } | null = null;
  const candidates: (string | undefined)[] = rawParticipants
    .map(p => p.key)
    .filter(k => k !== fromRaw.key);
  candidates.push(undefined); // move to end
  for (const beforeKey of candidates) {
    const result = moveParticipant(rawCode, config, fromRaw.key, beforeKey);
    if (result.warning) continue;
    const order = processedOrderOf(result.code, processCode(result.code, ctx), ctx);
    const score = scoreOf(order, result.code === rawCode);
    if (
      !best ||
      score[0] < best.score[0] ||
      (score[0] === best.score[0] && score[1] < best.score[1]) ||
      (score[0] === best.score[0] && score[1] === best.score[1] && score[2] < best.score[2])
    ) {
      best = { result, score };
    }
  }

  if (!best) {
    // No valid candidate (degenerate diagram): fall back to the direct edit.
    return moveParticipant(rawCode, config, fromRaw.key, beforeRaw?.key);
  }

  // Stuck drop: the best raw edit is a no-op but the user dropped at a
  // different rendered position — the color grouping makes the target
  // unreachable. Surface that as a hint instead of silently doing nothing.
  // (A drop at the current position is an intentional no-op: stay silent.)
  if (
    best.result.code === rawCode &&
    targetOrder.indexOf(fromId) !== currentOrder.indexOf(fromId)
  ) {
    return {
      code: rawCode,
      config,
      warning: `Cannot move "${fromId}" there: its position is constrained by the actor color groups (CONFIG actor colors). Assign it a color in the right panel to move it between groups.`,
    };
  }
  return best.result;
}
