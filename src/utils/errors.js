class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

class SlotUnavailableError extends Error {
  constructor(message = 'Este horario ya no está disponible') {
    super(message);
    this.status = 409;
  }
}

module.exports = { BadRequestError, SlotUnavailableError };
