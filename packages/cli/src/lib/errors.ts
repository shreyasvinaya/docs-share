export const EXIT_CODES = {
  SUCCESS: 0,
  AUTH_ERROR: 1,
  NETWORK_ERROR: 2,
  NOT_FOUND: 3,
  PERMISSION_DENIED: 4,
  FILE_NOT_FOUND: 5,
  VALIDATION_ERROR: 6,
  UNKNOWN: 99,
} as const;

export class CliError extends Error {
  exitCode: number;

  constructor(message: string, exitCode: number = EXIT_CODES.UNKNOWN) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class AuthError extends CliError {
  constructor(message = "Not authenticated. Run `patra login --token <TOKEN>` first.") {
    super(message, EXIT_CODES.AUTH_ERROR);
    this.name = "AuthError";
  }
}

export class NetworkError extends CliError {
  constructor(message = "Network error: could not reach the API server.") {
    super(message, EXIT_CODES.NETWORK_ERROR);
    this.name = "NetworkError";
  }
}

export class NotFoundError extends CliError {
  constructor(message = "Resource not found.") {
    super(message, EXIT_CODES.NOT_FOUND);
    this.name = "NotFoundError";
  }
}

export class PermissionDeniedError extends CliError {
  constructor(message = "Permission denied.") {
    super(message, EXIT_CODES.PERMISSION_DENIED);
    this.name = "PermissionDeniedError";
  }
}

export class FileNotFoundError extends CliError {
  constructor(path: string) {
    super(`File not found: ${path}`, EXIT_CODES.FILE_NOT_FOUND);
    this.name = "FileNotFoundError";
  }
}

export class ValidationError extends CliError {
  constructor(message = "Invalid input.") {
    super(message, EXIT_CODES.VALIDATION_ERROR);
    this.name = "ValidationError";
  }
}
