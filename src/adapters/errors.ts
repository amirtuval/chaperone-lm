import type { AdapterRequestError } from './types.js'

export function httpError(status: number, message: string, code?: string): AdapterRequestError {
  return {
    writeError(res) {
      res.status(status).json({ error: { message, type: 'invalid_request_error', code } })
    },
  }
}
