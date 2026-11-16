'use client';

/** Goals page groups: a goal's own type ("Move", "Fitness"…), else the site / section it belongs to. */
import { readSaved } from './storage';
import { ONGOING_KEY } from './ongoingGoals';
import { FOCUS_SECTION_LABELS, type FocusSectionId } from './focusRouting';
import { sourceById } from './sources';
import type { SourceId } from './types';

type GoalLike = { goalType?: string; site?: string; section?: string };

export function goalGroupOf(g: GoalLike): string {
  if (g.goalType?.trim()) return g.goalType.trim();
  if (g.section && g.section in FOCUS_SECTION_LABELS) return FOCUS_SECTION_LABELS[g.section as FocusSectionId];
  if (g.site && sourceById[g.site as SourceId]) return sourceById[g.site as SourceId].name;
  return 'Other';
}

/** Every group name in use (typed ones and the site / section ones), A–Z. */
export function readGoalTypes(): string[] {
  const items = readSaved<{ items?: GoalLike[] }>(ONGOING_KEY, { items: [] }).items || [];
  return [...new Set(items.map(goalGroupOf))].sort((a, b) => a.localeCompare(b));
}
