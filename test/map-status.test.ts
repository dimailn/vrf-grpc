import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Code } from '@connectrpc/connect'
import mapStatus from '../src/map-status'

describe('mapStatus', () => {
  it('maps recoverable/validation codes to SOFT_FAILURE', () => {
    for (const code of [
      Code.InvalidArgument,
      Code.FailedPrecondition,
      Code.OutOfRange,
      Code.AlreadyExists,
      Code.ResourceExhausted,
    ]) {
      assert.equal(mapStatus(code), 'SOFT_FAILURE')
    }
  })

  it('maps transport/availability codes to NETWORK_FAILURE', () => {
    for (const code of [Code.Unavailable, Code.DeadlineExceeded, Code.Canceled]) {
      assert.equal(mapStatus(code), 'NETWORK_FAILURE')
    }
  })

  it('maps server-side codes to SERVER_FAILURE', () => {
    for (const code of [Code.Internal, Code.DataLoss, Code.Unknown, Code.Unimplemented]) {
      assert.equal(mapStatus(code), 'SERVER_FAILURE')
    }
  })

  it('falls back to OTHER_FAILURE', () => {
    for (const code of [Code.Unauthenticated, Code.PermissionDenied, Code.NotFound]) {
      assert.equal(mapStatus(code), 'OTHER_FAILURE')
    }
  })
})
