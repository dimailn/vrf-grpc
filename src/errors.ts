import { ConnectError, Code } from '@connectrpc/connect'
import { BadRequest } from '../gen/ts/google/rpc/error_details_pb'
import mapStatus, { StatusHandle } from './map-status'

// vrf expects validation errors as a hash of field -> string[], with a special
// "base" key for form-level messages (see vrf-rest handleErrors).
export type FieldErrors = Record<string, string[]>

export interface NormalizedError {
  status: Code
  statusHandle: StatusHandle
  // Per-field errors extracted from google.rpc.BadRequest details, if any.
  fieldErrors: FieldErrors | null
  // Human-readable message, used when there are no structured field errors.
  message: string
}

// Extracts google.rpc.BadRequest field violations into vrf's field-errors shape.
// Returns null when the error carries no field-level detail, so the caller can
// fall back to a form-level ("base") message.
export function fieldErrorsFromConnectError(e: ConnectError): FieldErrors | null {
  const violations = e.findDetails(BadRequest).flatMap((br) => br.fieldViolations)

  if (violations.length === 0) {
    return null
  }

  return violations.reduce<FieldErrors>((acc, v) => {
    const field = v.field || 'base'
    ;(acc[field] ||= []).push(v.description)
    return acc
  }, {})
}

export function normalizeError(error: unknown): NormalizedError {
  const e = ConnectError.from(error)

  return {
    status: e.code,
    statusHandle: mapStatus(e.code),
    fieldErrors: fieldErrorsFromConnectError(e),
    message: e.rawMessage || e.message,
  }
}
