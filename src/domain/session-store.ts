import { CallSession } from "../contracts";
import { DomainError } from "./errors";

export class SessionStore {
  private readonly sessions = new Map<string, CallSession>();

  create(session: CallSession): CallSession {
    if (this.sessions.has(session.callId)) {
      throw new DomainError(409, "call_already_exists", `Call ${session.callId} already exists`);
    }
    this.sessions.set(session.callId, session);
    return session;
  }

  getOrThrow(callId: string): CallSession {
    const session = this.sessions.get(callId);
    if (!session) {
      throw new DomainError(404, "call_not_found", `Call ${callId} not found`);
    }
    return session;
  }

  replace(session: CallSession): CallSession {
    this.sessions.set(session.callId, session);
    return session;
  }
}
