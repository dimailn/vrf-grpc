import { Code } from '@connectrpc/connect'

export type StatusHandle =
  | 'SUCCESSFUL'
  | 'SOFT_FAILURE'
  | 'NETWORK_FAILURE'
  | 'SERVER_FAILURE'
  | 'OTHER_FAILURE'

// Maps a gRPC/Connect status code to the vrf statusHandle vocabulary,
// mirroring what vrf-rest derives from HTTP statuses.
export default function mapStatus(code: Code): StatusHandle {
  switch (code) {
    // Validation-like failures the user can recover from by editing the form.
    case Code.InvalidArgument:
    case Code.FailedPrecondition:
    case Code.OutOfRange:
    case Code.AlreadyExists:
    case Code.ResourceExhausted:
      return 'SOFT_FAILURE'

    // Transport / availability problems.
    case Code.Unavailable:
    case Code.DeadlineExceeded:
    case Code.Canceled:
      return 'NETWORK_FAILURE'

    // Server-side defects.
    case Code.Internal:
    case Code.DataLoss:
    case Code.Unknown:
    case Code.Unimplemented:
      return 'SERVER_FAILURE'

    default:
      return 'OTHER_FAILURE'
  }
}
