export class DomainError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function assertCondition(
  condition: boolean,
  statusCode: number,
  code: string,
  message: string
): asserts condition {
  if (!condition) {
    throw new DomainError(statusCode, code, message);
  }
}
