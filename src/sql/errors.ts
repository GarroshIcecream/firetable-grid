export interface GridRequestIssue {
  path: string;
  message: string;
}

export class GridRequestError extends Error {
  readonly name = "GridRequestError";
  constructor(readonly issues: readonly GridRequestIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

export class GridConfigError extends Error {
  readonly name = "GridConfigError";
}
