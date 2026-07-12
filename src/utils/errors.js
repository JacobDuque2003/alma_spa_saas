class AppError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class BadRequestError extends AppError {
  constructor(message) {
    super(message, 400);
  }
}

class SlotUnavailableError extends AppError {
  constructor(message = 'Este horario ya no está disponible') {
    super(message, 409);
  }
}

module.exports = { AppError, BadRequestError, SlotUnavailableError };
