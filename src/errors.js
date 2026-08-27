/**
 * A failure while looking something up over the network.
 * `kind` drives the user-facing message and is surfaced as a Result reason.
 */
export class LookupError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'LookupError';
    this.kind = kind;
  }
}
