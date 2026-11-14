export class RefreshRefusedError extends Error {
  code = 'CHATGPT_REFRESH_REFUSED';

  constructor(message, terminal) {
    super(message);
    this.terminal = terminal;
  }
}
