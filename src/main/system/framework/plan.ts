import {
  PlannedAction,
  BlockedAction,
  OperationPlan,
  Reversibility,
} from './types';

// In-memory plan store: plans are kept for execution confirmation
const activePlans = new Map<string, OperationPlan>();

export interface CreatePlanParams {
  module: string;
  actions: PlannedAction[];
  blocked?: BlockedAction[];
  reversibility: Reversibility;
  irreversibilityReason?: string;
  requiresElevation: boolean;
}

/**
 * Creates and validates an OperationPlan according to Phase 3 contract rules.
 *
 * Rails:
 * - Runtime check: an irreversible plan without an irreversibilityReason throws.
 * - totalReclaimableBytes: null when any action's reclaimableBytes is null (never guessed).
 * - Generates stable ID.
 * - Changes nothing on disk.
 */
export function createOperationPlan(params: CreatePlanParams): OperationPlan {
  // Runtime invariant: irreversibilityReason is REQUIRED when reversibility is 'irreversible'
  if (params.reversibility === 'irreversible') {
    if (!params.irreversibilityReason || !params.irreversibilityReason.trim()) {
      throw new Error(
        'Contract violation: an irreversible OperationPlan must specify an irreversibilityReason'
      );
    }
  }

  // Calculate totalReclaimableBytes:
  // If any action has null (unmeasured/unknown), the total is null.
  // Never guess or estimate an unmeasured size.
  let totalReclaimableBytes: number | null = 0;
  for (const action of params.actions) {
    if (action.reclaimableBytes === null) {
      totalReclaimableBytes = null;
      break;
    }
    totalReclaimableBytes += action.reclaimableBytes;
  }

  const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const plan: OperationPlan = {
    id: planId,
    module: params.module,
    actions: params.actions,
    blocked: params.blocked ?? [],
    totalReclaimableBytes,
    reversibility: params.reversibility,
    irreversibilityReason:
      params.reversibility === 'irreversible' ? params.irreversibilityReason : undefined,
    requiresElevation: params.requiresElevation,
    createdAt: new Date().toISOString(),
  };

  activePlans.set(planId, plan);
  return plan;
}

/**
 * Retrieves a plan by ID from the active plan cache.
 */
export function getOperationPlan(planId: string): OperationPlan | undefined {
  return activePlans.get(planId);
}

/**
 * Removes an executed or discarded plan.
 */
export function removeOperationPlan(planId: string): void {
  activePlans.delete(planId);
}

/**
 * Clears all active plans (for testing/cleanup).
 */
export function clearAllOperationPlans(): void {
  activePlans.clear();
}
