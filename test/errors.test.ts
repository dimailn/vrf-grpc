import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ConnectError, Code } from '@connectrpc/connect'
import { BadRequest } from '../gen/ts/google/rpc/error_details_pb'
import { normalizeError, fieldErrorsFromConnectError } from '../src/errors'

const withViolations = (violations: { field: string; description: string }[]) =>
  new ConnectError('validation failed', Code.InvalidArgument, undefined, [
    new BadRequest({ fieldViolations: violations }),
  ])

describe('fieldErrorsFromConnectError', () => {
  it('maps BadRequest field violations to vrf field errors', () => {
    const e = withViolations([{ field: 'title', description: "can't be blank" }])
    assert.deepEqual(fieldErrorsFromConnectError(e), { title: ["can't be blank"] })
  })

  it('groups multiple violations on the same field', () => {
    const e = withViolations([
      { field: 'title', description: 'too short' },
      { field: 'title', description: 'required' },
    ])
    assert.deepEqual(fieldErrorsFromConnectError(e), { title: ['too short', 'required'] })
  })

  it('routes field-less violations to "base"', () => {
    const e = withViolations([{ field: '', description: 'something broke' }])
    assert.deepEqual(fieldErrorsFromConnectError(e), { base: ['something broke'] })
  })

  it('returns null when there is no BadRequest detail', () => {
    const e = new ConnectError('nope', Code.Unavailable)
    assert.equal(fieldErrorsFromConnectError(e), null)
  })
})

describe('normalizeError', () => {
  it('extracts field errors and a SOFT_FAILURE handle from INVALID_ARGUMENT', () => {
    const n = normalizeError(withViolations([{ field: 'title', description: "can't be blank" }]))
    assert.equal(n.status, Code.InvalidArgument)
    assert.equal(n.statusHandle, 'SOFT_FAILURE')
    assert.deepEqual(n.fieldErrors, { title: ["can't be blank"] })
  })

  it('maps a transport error to NETWORK_FAILURE with no field errors', () => {
    const n = normalizeError(new ConnectError('down', Code.Unavailable))
    assert.equal(n.statusHandle, 'NETWORK_FAILURE')
    assert.equal(n.fieldErrors, null)
    assert.ok(n.message.includes('down'))
  })

  it('wraps a plain Error as an unknown server failure', () => {
    const n = normalizeError(new Error('boom'))
    assert.equal(n.status, Code.Unknown)
    assert.equal(n.statusHandle, 'SERVER_FAILURE')
    assert.equal(n.fieldErrors, null)
  })
})
