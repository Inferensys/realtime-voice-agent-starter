import { DomainError } from "./errors";

export const sessionStates = [
  "initiated",
  "active",
  "escalated",
  "handoff_pending",
  "handed_off",
  "closing",
  "closed",
  "failed"
] as const;

export type SessionState = (typeof sessionStates)[number];

const transitionMap: Record<SessionState, SessionState[]> = {
  initiated: ["active", "failed"],
  active: ["escalated", "closing", "failed"],
  escalated: ["handoff_pending", "failed"],
  handoff_pending: ["handed_off", "failed"],
  handed_off: ["closing", "failed"],
  closing: ["closed", "failed"],
  closed: [],
  failed: []
};

export function isTerminalState(state: SessionState): boolean {
  return state === "closed" || state === "failed";
}

export function canTransition(from: SessionState, to: SessionState): boolean {
  return transitionMap[from].includes(to);
}

export function transitionOrThrow(
  from: SessionState,
  to: SessionState
): SessionState {
  if (!canTransition(from, to)) {
    throw new DomainError(
      409,
      "invalid_state_transition",
      `Invalid transition ${from} -> ${to}`
    );
  }
  return to;
}
